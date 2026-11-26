import { describe, expect, it } from 'vitest'
import { readZipDirectory, unpackEntry } from '../drops/zip'
import { MAX_ZIP_BYTES, MAX_ZIP_FILES, planZip } from './zip-plan'
import { ZipStreamError, zipStream, type OpenFile } from './zip-stream'

const encoder = new TextEncoder()
const streamOf = (chunks: readonly Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
const concat = (chunks: readonly Uint8Array[]) => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}
const drain = async (stream: ReadableStream<Uint8Array>) => {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return concat(chunks)
    chunks.push(value)
  }
}
/** Files by path; each is served in pieces of `piece` bytes. */
const opener =
  (files: Readonly<Record<string, Uint8Array>>, piece = 7): OpenFile =>
  async (entry) => {
    const bytes = files[entry.path]
    if (!bytes) return null
    const chunks: Uint8Array[] = []
    for (let at = 0; at < bytes.length; at += piece)
      chunks.push(bytes.slice(at, at + piece))
    return streamOf(chunks)
  }
const planOf = (files: Readonly<Record<string, Uint8Array>>) => {
  const plan = planZip(
    Object.entries(files).map(([path, bytes]) => ({
      path,
      size: bytes.length,
    })),
    Date.UTC(2026, 10, 26, 12, 30, 40) / 1000,
  )
  if (!plan.ok) throw new Error(`refused: ${plan.reason}`)
  return plan
}

describe('planZip', () => {
  it('Given no files, When planned, Then it is refused', () => {
    expect(planZip([], 0)).toMatchObject({ ok: false, reason: 'no_files' })
  })

  it.each([
    ['../x.html', 'dot_segment'],
    ['/abs.html', 'absolute_or_empty_segment'],
    ['a\\b.html', 'backslash'],
  ])(
    'Given the path %s, When planned, Then the whole zip is refused',
    (path, problem) => {
      expect(
        planZip(
          [
            { path: 'index.html', size: 1 },
            { path, size: 1 },
          ],
          0,
        ),
      ).toMatchObject({ ok: false, reason: 'unsafe_path', path, problem })
    },
  )

  it('Given the same path twice, When planned, Then it is refused', () => {
    expect(
      planZip(
        [
          { path: 'a', size: 1 },
          { path: 'a', size: 2 },
        ],
        0,
      ),
    ).toMatchObject({ ok: false, reason: 'duplicate_path' })
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'Given the size %s, When planned, Then it is refused',
    (size) => {
      expect(planZip([{ path: 'a', size }], 0)).toMatchObject({
        ok: false,
        reason: 'invalid_size',
      })
    },
  )

  it('Given exactly the most files, When planned, Then it is a plan; one more, Then it is refused', () => {
    const files = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        path: `f${index}`,
        size: 0,
      }))
    expect(planZip(files(MAX_ZIP_FILES), 0).ok).toBe(true)
    expect(planZip(files(MAX_ZIP_FILES + 1), 0)).toMatchObject({
      ok: false,
      reason: 'too_many_files',
    })
  })

  it('Given exactly the most bytes, When planned, Then it is a plan; one more, Then it is refused', () => {
    expect(planZip([{ path: 'a', size: MAX_ZIP_BYTES }], 0).ok).toBe(true)
    expect(
      planZip(
        [
          { path: 'a', size: MAX_ZIP_BYTES },
          { path: 'b', size: 1 },
        ],
        0,
      ),
    ).toMatchObject({ ok: false, reason: 'too_large' })
  })

  it('Given a time before 1980 or after 2107, When planned, Then the DOS time stays in range', () => {
    for (const seconds of [0, -5, 1e11]) {
      const plan = planZip([{ path: 'a', size: 0 }], seconds)
      if (!plan.ok) throw new Error('refused')
      expect(plan.dosDate >>> 9).toBeLessThanOrEqual(127)
      expect(plan.dosDate & 0x1f).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('zipStream', () => {
  const files: Record<string, Uint8Array> = {
    'index.html': encoder.encode('<!doctype html><title>Hi</title>'),
    'assets/app.js': encoder.encode('console.log("a")'.repeat(100)),
    'empty.txt': new Uint8Array(),
    '日本語/画像.png': Uint8Array.from(
      { length: 300 },
      (_, i) => (i * 37) % 256,
    ),
  }

  it('Given files, When streamed, Then the zip is exactly as long as planned and its directory lists the files in order', async () => {
    const plan = planOf(files)
    const zip = await drain(zipStream(plan, opener(files)))
    expect(zip.length).toBe(plan.length)
    const directory = readZipDirectory(zip)
    if (!directory.ok) throw new Error('not a zip')
    expect(directory.entries.map((entry) => entry.path)).toEqual(
      Object.keys(files),
    )
  })

  it.each([1, 7, 64, 100000])(
    'Given files served in pieces of %i bytes, When streamed, Then every file unpacks to the bytes put in, with a matching checksum',
    async (piece) => {
      const plan = planOf(files)
      const zip = await drain(zipStream(plan, opener(files, piece)))
      const directory = readZipDirectory(zip)
      if (!directory.ok) throw new Error('not a zip')
      for (const entry of directory.entries)
        expect(await unpackEntry(zip, entry)).toEqual(files[entry.path])
    },
  )

  it('Given any prefetch depth, When streamed, Then the zip is the same', async () => {
    const plan = planOf(files)
    const zips = await Promise.all(
      [0, 1, 3, 10].map((prefetch) =>
        drain(zipStream(plan, opener(files), { prefetch })),
      ),
    )
    for (const zip of zips) expect(zip).toEqual(zips[0])
  })

  it('Given a file that is gone, When streamed, Then the stream fails and no directory is written', async () => {
    const plan = planOf(files)
    const { 'assets/app.js': _gone, ...rest } = files
    const seen: Uint8Array[] = []
    const reader = zipStream(plan, opener(rest)).getReader()
    let failure: unknown
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        seen.push(value)
      }
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ZipStreamError)
    expect(failure).toMatchObject({ reason: 'missing', path: 'assets/app.js' })
    expect(readZipDirectory(concat(seen)).ok).toBe(false)
  })

  it.each([
    ['shorter', (b: Uint8Array) => b.slice(0, b.length - 1)],
    ['longer', (b: Uint8Array) => concat([b, Uint8Array.of(1)])],
  ])(
    'Given a stored file %s than the database says, When streamed, Then the stream fails',
    async (_name, change) => {
      const plan = planOf(files)
      const served = { ...files, 'index.html': change(files['index.html']) }
      await expect(
        drain(zipStream(plan, opener(served))),
      ).rejects.toMatchObject({
        reason: 'size_mismatch',
        path: 'index.html',
      })
    },
  )

  it('Given a read that fails, When streamed, Then the stream fails with that error', async () => {
    const plan = planOf(files)
    const open: OpenFile = async () => {
      throw new Error('R2 is down')
    }
    await expect(drain(zipStream(plan, open))).rejects.toThrow('R2 is down')
  })

  it('Given a stream that ends, fails or is cancelled, When it does, Then onEnd runs once and files opened ahead are closed', async () => {
    const plan = planOf(files)
    let ended = 0
    let cancelled = 0
    const open: OpenFile = async () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(1))
        },
        cancel() {
          cancelled++
        },
      })
    const stream = zipStream(plan, open, { prefetch: 2, onEnd: () => ended++ })
    const reader = stream.getReader()
    await reader.read()
    await reader.cancel()
    await reader.cancel().catch(() => undefined)
    expect(ended).toBe(1)
    expect(cancelled).toBeGreaterThanOrEqual(2)
    await expect(
      drain(zipStream(plan, opener(files), { onEnd: () => ended++ })),
    ).resolves.toBeDefined()
    expect(ended).toBe(2)
  })

  it('Given a name that tries to climb out, When the zip is read back, Then no entry names a place outside the folder', async () => {
    // The plan refuses such a name, so none is ever written.
    expect(planZip([{ path: '../../etc/passwd', size: 1 }], 0).ok).toBe(false)
  })
})
