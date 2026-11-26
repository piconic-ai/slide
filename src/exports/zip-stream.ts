// Writes a planned zip as a stream, one file at a time, so no more than a
// chunk or two of any file is held in memory at once. Pure apart from what
// `open` does: it is handed the way to read a file's bytes.
import { crc32Finish, crc32Update, CRC32_START } from './crc32'
import { dataDescriptor, directoryAndEnd, localHeader } from './zip-format'
import type { PlannedEntry, ZipPlan } from './zip-plan'

/** Why a stream stopped before its end. */
export class ZipStreamError extends Error {
  constructor(
    readonly reason: 'missing' | 'size_mismatch',
    readonly path: string,
  ) {
    super(`Zip stream stopped: ${reason}`)
    this.name = 'ZipStreamError'
  }
}

/** The bytes of one file, or null when the file is not there. */
export type OpenFile = (
  entry: PlannedEntry,
) => Promise<ReadableStream<Uint8Array> | null>

/**
 * Only files up to this size are opened ahead of their turn. A file opened
 * early may hold bytes until the writer reaches it; capping what is opened
 * early keeps that to a few MiB however large the upload limits are set.
 */
export const PREFETCH_MAX_BYTES = 1024 * 1024

export type ZipStreamOptions = Readonly<{
  /**
   * How many files after the one being written may be opened early, to hide
   * the time a read from R2 takes (only those of PREFETCH_MAX_BYTES or less).
   * Each is a read that holds a connection (a Worker may wait on six at once).
   */
  prefetch?: number
  /** Called once when the stream ends, fails or is cancelled. */
  onEnd?: () => void
}>

type Opened =
  | Readonly<{ ok: true; body: ReadableStream<Uint8Array> | null }>
  | Readonly<{ ok: false; error: unknown }>

/**
 * The zip as a stream of bytes. If a file is missing or its length is not
 * what the plan says, the stream fails instead of finishing: a zip whose
 * central directory is missing is refused by every tool, where a finished
 * one with a wrong file in it would not be. The central directory is written
 * only after every file has been written and checked.
 */
export function zipStream(
  plan: ZipPlan,
  open: OpenFile,
  options: ZipStreamOptions = {},
): ReadableStream<Uint8Array> {
  const prefetch = Math.max(0, options.prefetch ?? 3)
  const opening = new Map<number, Promise<Opened>>()
  const checksums: number[] = []
  let next = 0
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let state = CRC32_START
  let written = 0
  let ended = false

  const end = () => {
    if (ended) return
    ended = true
    options.onEnd?.()
  }
  const start = (index: number) => {
    const entry = plan.entries[index]
    if (!entry || opening.has(index)) return
    opening.set(
      index,
      open(entry).then(
        (body): Opened => ({ ok: true, body }),
        (error): Opened => ({ ok: false, error }),
      ),
    )
  }
  const closeAhead = async () => {
    const pending = [...opening.values()]
    opening.clear()
    for (const result of await Promise.all(pending))
      if (result.ok) await result.body?.cancel().catch(() => undefined)
  }

  const finishFile = (
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) => {
    const entry = plan.entries[next]!
    if (written !== entry.size)
      throw new ZipStreamError('size_mismatch', entry.path)
    const crc = crc32Finish(state)
    checksums.push(crc)
    controller.enqueue(dataDescriptor(crc, entry.size))
    reader = null
    next++
  }

  const beginFile = async (
    controller: ReadableStreamDefaultController<Uint8Array>,
    entry: PlannedEntry,
  ) => {
    start(next)
    for (let ahead = 1; ahead <= prefetch; ahead++) {
      const later = plan.entries[next + ahead]
      if (later && later.size <= PREFETCH_MAX_BYTES) start(next + ahead)
    }
    const opened = await opening.get(next)!
    opening.delete(next)
    if (!opened.ok) throw opened.error
    if (!opened.body) throw new ZipStreamError('missing', entry.path)
    reader = opened.body.getReader()
    state = CRC32_START
    written = 0
    controller.enqueue(localHeader(plan, entry))
  }

  const step = async (
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) => {
    if (next >= plan.entries.length) {
      controller.enqueue(directoryAndEnd(plan, checksums))
      controller.close()
      end()
      return
    }
    const entry = plan.entries[next]!
    if (!reader) return beginFile(controller, entry)
    const { done, value } = await reader.read()
    if (done) return finishFile(controller)
    written += value.byteLength
    // Stop at the first byte too many, before the rest is read.
    if (written > entry.size)
      throw new ZipStreamError('size_mismatch', entry.path)
    state = crc32Update(state, value)
    controller.enqueue(value)
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        await step(controller)
      } catch (error) {
        await reader?.cancel().catch(() => undefined)
        reader = null
        await closeAhead()
        end()
        controller.error(error)
      }
    },
    async cancel() {
      await reader?.cancel().catch(() => undefined)
      reader = null
      await closeAhead()
      end()
    },
  })
}
