import { describe, expect, it } from 'vitest'
import { MAX_ZIP_BYTES, MAX_ZIP_FILES, planZip } from './zip-plan'
import { zipStream, type OpenFile } from './zip-stream'

const CHUNK = 64 * 1024
const chunk = Uint8Array.from({ length: CHUNK }, (_, i) => (i * 13 + 5) % 256)

/** A file of `size` bytes served in 64 KiB pieces, one piece per pull. */
const opener = (): OpenFile => async (entry) => {
  let left = entry.size
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (left === 0) return controller.close()
      const take = Math.min(left, CHUNK)
      left -= take
      controller.enqueue(take === CHUNK ? chunk : chunk.subarray(0, take))
    },
  })
}

/** Reads a stream to its end without keeping it; returns bytes and peak memory. */
async function drain(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  let bytes = 0
  let peak = process.memoryUsage().rss
  let reads = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (++reads % 256 === 0) peak = Math.max(peak, process.memoryUsage().rss)
  }
  return { bytes, peak }
}

describe('zipStream at the largest size a zip may have', () => {
  it('F35-AC10: Given the most files and the most bytes a zip may hold, When it is streamed, Then it finishes in time without holding the zip in memory', async () => {
    const perFile = Math.floor(MAX_ZIP_BYTES / MAX_ZIP_FILES)
    const files = Array.from({ length: MAX_ZIP_FILES }, (_, index) => ({
      path: `assets/file-${String(index).padStart(4, '0')}.bin`,
      // The last file takes the remainder, so the total is exactly the most.
      size:
        index === MAX_ZIP_FILES - 1
          ? MAX_ZIP_BYTES - perFile * (MAX_ZIP_FILES - 1)
          : perFile,
    }))
    const plan = planZip(files, 1_800_000_000)
    if (!plan.ok) throw new Error(`refused: ${plan.reason}`)
    const before = process.memoryUsage().rss

    const started = performance.now()
    const { bytes, peak } = await drain(zipStream(plan, opener()))
    const seconds = (performance.now() - started) / 1000

    expect(bytes).toBe(plan.length)
    // Checksumming is the one cost per byte; the whole zip within a Worker's
    // default 30 s of CPU time with a wide margin.
    expect(seconds).toBeLessThan(10)
    // A tenth of the zip at most; a streamed zip holds a few chunks.
    expect(peak - before).toBeLessThan(MAX_ZIP_BYTES / 10)
  }, 60_000)

  it('F35-AC10: Given a version of hundreds of tiny files, When it is streamed, Then the per-file cost is small', async () => {
    const files = Array.from({ length: MAX_ZIP_FILES }, (_, index) => ({
      path: `f/${index}.txt`,
      size: 100,
    }))
    const plan = planZip(files, 1_800_000_000)
    if (!plan.ok) throw new Error('refused')

    const started = performance.now()
    const { bytes } = await drain(zipStream(plan, opener()))

    expect(bytes).toBe(plan.length)
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
