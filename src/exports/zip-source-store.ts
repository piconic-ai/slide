// Turns the files of one stored version into a zip stream, reading each
// file's bytes from R2 as the stream reaches it.
import type { ExportVersionFiles } from './deck-export-store'
import { planZip } from './zip-plan'
import { zipStream, type OpenFile } from './zip-stream'

export type VersionZip =
  | Readonly<{
      kind: 'zip'
      /** The exact length of the zip, for the Content-Length header. */
      length: number
      stream: ReadableStream<Uint8Array>
    }>
  /** More files or bytes than one zip holds (see zip-plan.ts). */
  | Readonly<{ kind: 'too_large' }>
  /** The version cannot be written as a faithful zip; nothing is sent. */
  | Readonly<{ kind: 'unavailable' }>

/**
 * The stored object of one file of a version. Its key must sit under the
 * version's own prefix in R2 (`<deployment>/…`): a row that named another
 * object, such as another version's or a picture, reads nothing, not that
 * object.
 */
export async function readVersionObject(
  bucket: R2Bucket,
  deploymentId: string,
  key: string | null | undefined,
): Promise<R2ObjectBody | null> {
  if (!key || !key.startsWith(`${deploymentId}/`)) return null
  return bucket.get(key)
}

/** The reader of a version's files, for the zip; see `readVersionObject`. */
export function r2Opener(
  bucket: R2Bucket,
  deploymentId: string,
  files: ReadonlyMap<string, string | null>,
): OpenFile {
  return async (entry) =>
    (await readVersionObject(bucket, deploymentId, files.get(entry.path)))
      ?.body ?? null
}

/**
 * Passes the stream through a stream that knows its length when the runtime
 * has one (Workers do), so the response carries a Content-Length and the
 * connection is cut if the bytes do not add up.
 */
function withKnownLength(
  stream: ReadableStream<Uint8Array>,
  length: number,
): ReadableStream<Uint8Array> {
  const Fixed = (
    globalThis as {
      FixedLengthStream?: new (length: number) => {
        readable: ReadableStream<Uint8Array>
        writable: WritableStream<Uint8Array>
      }
    }
  ).FixedLengthStream
  if (!Fixed) return stream
  const { readable, writable } = new Fixed(length)
  stream.pipeTo(writable).catch(() => undefined)
  return readable
}

/**
 * The zip of one version, or why there is none. `onEnd` runs once when the
 * stream ends, fails or is cancelled; when there is no stream, it never runs
 * and the caller gives back what it holds.
 */
export function versionZip(
  bucket: R2Bucket,
  version: Extract<ExportVersionFiles, { kind: 'files' }>,
  onEnd: () => void,
): VersionZip {
  const plan = planZip(version.files, version.version.readyAt)
  if (!plan.ok)
    return plan.reason === 'too_many_files' || plan.reason === 'too_large'
      ? { kind: 'too_large' }
      : { kind: 'unavailable' }
  const keys = new Map(version.files.map((file) => [file.path, file.objectKey]))
  if ([...keys.values()].some((key) => key === null))
    return { kind: 'unavailable' }
  const stream = zipStream(
    plan,
    r2Opener(bucket, version.version.deploymentId, keys),
    { onEnd },
  )
  return {
    kind: 'zip',
    length: plan.length,
    stream: withKnownLength(stream, plan.length),
  }
}
