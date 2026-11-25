import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readZipDirectory, unpackEntry } from './zip'

describe('readZipDirectory', () => {
  it('Given a zip the system zip tool made, When read, Then its files are listed and unpack to what was packed', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'slide-zip-test-'))
    try {
      mkdirSync(join(directory, 'deck/css'), { recursive: true })
      writeFileSync(
        join(directory, 'deck/index.html'),
        '<!doctype html><p>real</p>',
      )
      writeFileSync(
        join(directory, 'deck/css/site.css'),
        'p{color:red}'.repeat(50),
      )
      execFileSync('zip', ['-q', '-r', 'deck.zip', 'deck'], { cwd: directory })
      const zip = new Uint8Array(readFileSync(join(directory, 'deck.zip')))

      const archive = readZipDirectory(zip)
      if (!archive.ok) throw new Error('expected a valid ZIP archive')
      const entries = archive.entries

      expect(entries.map(({ path }) => path).sort()).toEqual([
        'deck/css/site.css',
        'deck/index.html',
      ])
      const index = entries.find(({ path }) => path === 'deck/index.html')
      expect(await unpackEntry(zip, index!)).toEqual(
        new TextEncoder().encode('<!doctype html><p>real</p>'),
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('symbolic links', () => {
  it('Given a zip the system zip tool made with a link kept as a link, When read, Then it is refused for the link', () => {
    const directory = mkdtempSync(join(tmpdir(), 'slide-zip-link-'))
    try {
      writeFileSync(join(directory, 'index.html'), '<!doctype html>')
      writeFileSync(join(directory, 'v2.css'), 'a{}')
      execFileSync('ln', ['-s', 'v2.css', 'latest.css'], { cwd: directory })
      execFileSync(
        'zip',
        ['-q', '-y', 'deck.zip', 'index.html', 'v2.css', 'latest.css'],
        { cwd: directory },
      )

      const archive = readZipDirectory(
        new Uint8Array(readFileSync(join(directory, 'deck.zip'))),
      )
      expect(archive).toEqual({
        ok: false,
        refusal: { reason: 'unsupported_zip', feature: 'symlink' },
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
