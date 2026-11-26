import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planZip } from './zip-plan'
import { zipStream, type OpenFile } from './zip-stream'

const encoder = new TextEncoder()
const files: Record<string, Uint8Array> = {
  'index.html': encoder.encode('<!doctype html><p>hi</p>'),
  'assets/app.js': encoder.encode('1+1\n'.repeat(5000)),
  'img/bin.png': Uint8Array.from(
    { length: 70_000 },
    (_, i) => (i * 7919) % 251,
  ),
  'empty.txt': new Uint8Array(),
  '日本語/資料.html': encoder.encode('<p>こんにちは</p>'),
}

async function makeZip(): Promise<Uint8Array> {
  const plan = planZip(
    Object.entries(files).map(([path, bytes]) => ({
      path,
      size: bytes.length,
    })),
    Date.UTC(2026, 10, 26, 9, 8, 6) / 1000,
  )
  if (!plan.ok) throw new Error('refused')
  const open: OpenFile = async (entry) => {
    const bytes = files[entry.path]!
    return new ReadableStream({
      start(controller) {
        for (let at = 0; at < bytes.length; at += 4096)
          controller.enqueue(bytes.slice(at, at + 4096))
        controller.close()
      },
    })
  }
  const reader = zipStream(plan, open).getReader()
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

const withZip = async (run: (directory: string, zipPath: string) => void) => {
  const directory = mkdtempSync(join(tmpdir(), 'slide-export-zip-'))
  try {
    const zipPath = join(directory, 'export.zip')
    writeFileSync(zipPath, await makeZip())
    run(directory, zipPath)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const walk = (root: string, dir = ''): string[] =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const path = dir ? `${dir}/${name}` : name
    return statSync(join(root, path)).isDirectory() ? walk(root, path) : [path]
  })

describe('the zip, read by the tools people use', () => {
  it('F35-AC3: Given an exported zip, When Info-ZIP unzip tests and extracts it, Then it reports no error and the files are the ones put in', async () => {
    await withZip((directory, zipPath) => {
      execFileSync('unzip', ['-tq', zipPath])
      const out = join(directory, 'out')
      execFileSync('unzip', ['-q', zipPath, '-d', out], {
        // Info-ZIP reads UTF-8 names (flag bit 11) only in a UTF-8 locale.
        env: { ...process.env, LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' },
      })
      expect(walk(out).sort()).toEqual(
        Object.keys(files)
          .map((path) => path.normalize('NFC'))
          .sort(),
      )
      for (const [path, bytes] of Object.entries(files))
        expect(readFileSync(join(out, path))).toEqual(Buffer.from(bytes))
    })
  })

  it('F35-AC3: Given an exported zip, When Python reads it, Then it passes its own integrity test and yields the same bytes', async () => {
    await withZip((_directory, zipPath) => {
      const script = [
        'import sys, zipfile, hashlib, json',
        'z = zipfile.ZipFile(sys.argv[1])',
        'assert z.testzip() is None',
        'print(json.dumps({i.filename: hashlib.sha256(z.read(i)).hexdigest() for i in z.infolist()}))',
      ].join('\n')
      const out = JSON.parse(
        execFileSync('python3', ['-I', '-c', script, zipPath]).toString(),
      ) as Record<string, string>
      expect(Object.keys(out).sort()).toEqual(Object.keys(files).sort())
      for (const [path, bytes] of Object.entries(files))
        expect(out[path]).toBe(
          Buffer.from(
            require('node:crypto').createHash('sha256').update(bytes).digest(),
          ).toString('hex'),
        )
    })
  })

  it('F35-AC8: Given an exported zip, When Python lists its names, Then none is absolute, climbs out, or has a backslash, and every entry is a plain file', async () => {
    await withZip((_directory, zipPath) => {
      const script = [
        'import sys, zipfile, json',
        'z = zipfile.ZipFile(sys.argv[1])',
        'print(json.dumps([[i.filename, i.external_attr >> 16, i.create_system] for i in z.infolist()]))',
      ].join('\n')
      const list = JSON.parse(
        execFileSync('python3', ['-I', '-c', script, zipPath]).toString(),
      ) as [string, number, number][]
      for (const [name, mode, system] of list) {
        expect(name.startsWith('/')).toBe(false)
        expect(name.split('/')).not.toContain('..')
        expect(name).not.toContain('\\')
        // A regular file, not executable: nothing extracts as a link or a program.
        expect(mode).toBe(0o100644)
        expect(system).toBe(3)
      }
    })
  })
})
