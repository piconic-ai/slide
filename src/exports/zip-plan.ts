// Lays out the zip of one version before a byte is written: which entries
// there are, where each starts, and how long the whole is. Pure.
//
// The zip is "stored" (no compression): the slides' images, fonts and media
// are compressed already, and storing keeps the size of every record known
// from the database, so the length of the whole zip is known before the
// first byte is sent. The CRC-32 is not known until a file is read, so each
// entry carries a data descriptor after its bytes and the central directory
// at the end holds the checksums (bit 3 of the flags). Readers that start
// from the central directory, which is every desktop tool, read it as it is.
import { zipNameProblem, type ZipNameProblem } from './zip-name'

/**
 * How many files one zip may hold. Each file is one read from R2, and every
 * read is a subrequest; a Worker on the paid plan may make 10,000 in one
 * invocation. The upload limit may be raised to 500 files a version
 * (`MAX_FILES_SETTING`), so the zip takes as many; a version cannot hold more.
 */
export const MAX_ZIP_FILES = 500

/**
 * How many bytes the files of one zip may add up to. Upload limits are
 * configuration and may be raised far past the defaults (10 MB a version,
 * 50 MB an author); the zip stays within what a Worker can checksum within
 * its CPU time (see docs/dev/f35-export.md) and within a 32-bit offset, so
 * no zip64 records are needed.
 */
export const MAX_ZIP_BYTES = 256 * 1024 * 1024

export type ZipFile = Readonly<{ path: string; size: number }>

export type PlannedEntry = Readonly<{
  path: string
  nameBytes: Uint8Array
  size: number
  /** Where the entry's local header starts in the zip. */
  offset: number
}>

export type ZipPlan = Readonly<{
  ok: true
  entries: readonly PlannedEntry[]
  /** The DOS time and date every entry carries. */
  dosTime: number
  dosDate: number
  /** Where the central directory starts. */
  directoryOffset: number
  /** The exact length of the zip in bytes. */
  length: number
}>

export type ZipRefusal = Readonly<{
  ok: false
  reason:
    | 'no_files'
    | 'too_many_files'
    | 'too_large'
    | 'unsafe_path'
    | 'duplicate_path'
    | 'invalid_size'
  /** The path at fault, for `unsafe_path` and `duplicate_path`. */
  path?: string
  problem?: ZipNameProblem
}>

export const LOCAL_HEADER_BYTES = 30
export const DATA_DESCRIPTOR_BYTES = 16
export const DIRECTORY_ENTRY_BYTES = 46
export const END_RECORD_BYTES = 22

/** Seconds since the epoch as the DOS time and date a zip records (UTC). */
export function dosDateTime(seconds: number): { time: number; date: number } {
  const at = new Date(Math.max(seconds, 315532800) * 1000)
  const year = Math.min(at.getUTCFullYear(), 2107)
  return {
    time:
      (at.getUTCHours() << 11) |
      (at.getUTCMinutes() << 5) |
      Math.floor(at.getUTCSeconds() / 2),
    date:
      ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  }
}

const encoder = new TextEncoder()

/**
 * The layout of a zip of these files, in the order given, with the
 * modification time `modifiedAt` (seconds) on every entry; or why the files
 * cannot be a zip. Every path is checked here, whatever checked it before.
 */
export function planZip(
  files: readonly ZipFile[],
  modifiedAt: number,
): ZipPlan | ZipRefusal {
  if (files.length === 0) return { ok: false, reason: 'no_files' }
  if (files.length > MAX_ZIP_FILES)
    return { ok: false, reason: 'too_many_files' }
  const seen = new Set<string>()
  const entries: PlannedEntry[] = []
  let offset = 0
  let total = 0
  let directoryBytes = END_RECORD_BYTES
  for (const file of files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0)
      return { ok: false, reason: 'invalid_size', path: file.path }
    const problem = zipNameProblem(file.path)
    if (problem)
      return { ok: false, reason: 'unsafe_path', path: file.path, problem }
    if (seen.has(file.path))
      return { ok: false, reason: 'duplicate_path', path: file.path }
    seen.add(file.path)
    total += file.size
    if (total > MAX_ZIP_BYTES) return { ok: false, reason: 'too_large' }
    const nameBytes = encoder.encode(file.path)
    entries.push({ path: file.path, nameBytes, size: file.size, offset })
    offset +=
      LOCAL_HEADER_BYTES + nameBytes.length + file.size + DATA_DESCRIPTOR_BYTES
    directoryBytes += DIRECTORY_ENTRY_BYTES + nameBytes.length
  }
  const { time, date } = dosDateTime(modifiedAt)
  return {
    ok: true,
    entries,
    dosTime: time,
    dosDate: date,
    directoryOffset: offset,
    length: offset + directoryBytes,
  }
}
