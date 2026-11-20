/** A file inside a zip, as its central directory lists it. */
export type ZipEntry = Readonly<{
  path: string
  /** The size the zip says the file has once unpacked. */
  size: number
  compressedSize: number
  /** 0 is stored as it is, 8 is deflate. */
  method: 0 | 8
  crc32: number
  /** Where the file's local header starts. */
  offset: number
}>

export type ZipRefusal =
  /** Not a zip, or one whose records do not add up. */
  | Readonly<{ reason: 'invalid_zip' }>
  /** A zip this reader does not take: which feature, for the wording. */
  | Readonly<{
      reason: 'unsupported_zip'
      feature: 'encrypted' | 'zip64' | 'compression' | 'names' | 'symlink'
    }>
  /** A name that points outside the slide, or is no file path at all. */
  | Readonly<{ reason: 'unsafe_path'; path: string }>
  | Readonly<{ reason: 'duplicate_path'; path: string }>

export type ZipDirectory =
  | Readonly<{ ok: true; entries: readonly ZipEntry[] }>
  | Readonly<{ ok: false; refusal: ZipRefusal }>

const END_OF_DIRECTORY = 0x06054b50
const DIRECTORY_ENTRY = 0x02014b50
const LOCAL_HEADER = 0x04034b50
const END_LENGTH = 22
const ENTRY_LENGTH = 46
const LOCAL_LENGTH = 30
/** A zip may end in a comment of up to this many bytes. */
const MAX_COMMENT = 0xffff
/** Bit 0 of the flags: the file is encrypted. */
const ENCRYPTED = 1
/** A count or size the 32-bit records cannot hold, kept in zip64 records. */
const ZIP64_COUNT = 0xffff
const ZIP64_SIZE = 0xffffffff

const refuse = (refusal: ZipRefusal): ZipDirectory => ({ ok: false, refusal })
const INVALID = refuse({ reason: 'invalid_zip' })

/** Where the record that ends the directory starts, searching from the end. */
function findEnd(view: DataView): number {
  const first = Math.max(0, view.byteLength - END_LENGTH - MAX_COMMENT)
  for (let at = view.byteLength - END_LENGTH; at >= first; at--)
    if (view.getUint32(at, true) === END_OF_DIRECTORY) return at
  return -1
}

/**
 * Whether a name is a path of a file inside the slide: segments separated
 * by `/`, none empty, none `.` or `..`, no backslash, drive or control
 * character. A zip made on purpose can name `../../x` or `/etc/x`.
 */
function isSafePath(path: string): boolean {
  if (/[\\\u0000-\u001f\u007f]|^[A-Za-z]:/.test(path)) return false
  return path
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/** The system a zip's entry was made on that records UNIX file modes. */
const MADE_ON_UNIX = 3
/** The file type bits of a UNIX mode, and their value for a symbolic link. */
const FILE_TYPE = 0xf000
const SYMBOLIC_LINK = 0xa000

type RawEntry = Readonly<{
  name: Uint8Array
  /** Whether the entry is a symbolic link: its bytes are a path, not a file. */
  symlink: boolean
  flags: number
  method: number
  crc32: number
  compressedSize: number
  size: number
  offset: number
  next: number
}>

function rawEntry(
  bytes: Uint8Array,
  view: DataView,
  at: number,
): RawEntry | null {
  if (
    at + ENTRY_LENGTH > bytes.length ||
    view.getUint32(at, true) !== DIRECTORY_ENTRY
  )
    return null
  const nameLength = view.getUint16(at + 28, true)
  const next =
    at +
    ENTRY_LENGTH +
    nameLength +
    view.getUint16(at + 30, true) +
    view.getUint16(at + 32, true)
  if (next > bytes.length) return null
  return {
    name: bytes.subarray(at + ENTRY_LENGTH, at + ENTRY_LENGTH + nameLength),
    // The mode sits in the high half of the external attributes.
    symlink:
      view.getUint8(at + 5) === MADE_ON_UNIX &&
      ((view.getUint32(at + 38, true) >>> 16) & FILE_TYPE) === SYMBOLIC_LINK,
    flags: view.getUint16(at + 8, true),
    method: view.getUint16(at + 10, true),
    crc32: view.getUint32(at + 16, true),
    compressedSize: view.getUint32(at + 20, true),
    size: view.getUint32(at + 24, true),
    offset: view.getUint32(at + 42, true),
    next,
  }
}

const names = new TextDecoder('utf-8', { fatal: true })

/** One entry as a file of the slide, a refusal, or null for a folder. */
function entryOf(raw: RawEntry): ZipEntry | ZipRefusal | null {
  let path: string
  try {
    path = names.decode(raw.name)
  } catch {
    return { reason: 'unsupported_zip', feature: 'names' }
  }
  // A folder is listed with a trailing slash and holds no bytes.
  if (path.endsWith('/')) return null
  if (!isSafePath(path)) return { reason: 'unsafe_path', path }
  // Unpacked as a file, a link would be a file holding the link's target.
  if (raw.symlink) return { reason: 'unsupported_zip', feature: 'symlink' }
  if (raw.flags & ENCRYPTED)
    return { reason: 'unsupported_zip', feature: 'encrypted' }
  if (
    raw.size === ZIP64_SIZE ||
    raw.compressedSize === ZIP64_SIZE ||
    raw.offset === ZIP64_SIZE
  )
    return { reason: 'unsupported_zip', feature: 'zip64' }
  if (raw.method !== 0 && raw.method !== 8)
    return { reason: 'unsupported_zip', feature: 'compression' }
  return {
    path,
    size: raw.size,
    compressedSize: raw.compressedSize,
    method: raw.method,
    crc32: raw.crc32,
    offset: raw.offset,
  }
}

/**
 * Lists the files of a zip from its central directory, without unpacking
 * any. Folders are left out. A zip that is encrypted, uses zip64 or a
 * compression other than deflate, holds a symbolic link, or names a file
 * outside the slide or twice, is refused as a whole.
 */
export function readZipDirectory(bytes: Uint8Array): ZipDirectory {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = findEnd(view)
  if (end < 0) return INVALID
  const count = view.getUint16(end + 10, true)
  const start = view.getUint32(end + 16, true)
  if (count === ZIP64_COUNT || start === ZIP64_SIZE)
    return refuse({ reason: 'unsupported_zip', feature: 'zip64' })
  const entries: ZipEntry[] = []
  const seen = new Set<string>()
  let at = start
  for (let index = 0; index < count; index++) {
    const raw = rawEntry(bytes, view, at)
    if (!raw) return INVALID
    at = raw.next
    const entry = entryOf(raw)
    if (entry === null) continue
    if ('reason' in entry) return refuse(entry)
    const key = entry.path.normalize('NFC')
    if (seen.has(key))
      return refuse({ reason: 'duplicate_path', path: entry.path })
    seen.add(key)
    entries.push(entry)
  }
  return { ok: true, entries }
}

/** The packed bytes of an entry, or null when its records point outside the zip. */
function packedBytes(bytes: Uint8Array, entry: ZipEntry): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const at = entry.offset
  if (
    at + LOCAL_LENGTH > bytes.length ||
    view.getUint32(at, true) !== LOCAL_HEADER
  )
    return null
  const start =
    at +
    LOCAL_LENGTH +
    view.getUint16(at + 26, true) +
    view.getUint16(at + 28, true)
  const end = start + entry.compressedSize
  return end > bytes.length ? null : bytes.subarray(start, end)
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

/** The CRC-32 a zip stores for a file, to tell damaged bytes. */
export function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes)
    value = (CRC_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

/**
 * Inflates raw deflate data, giving up as soon as more than `limit` bytes
 * come out: a zip can claim a small file and unpack to gigabytes.
 */
async function inflate(
  packed: Uint8Array,
  limit: number,
): Promise<Uint8Array | null> {
  const stream = new Blob([new Uint8Array(packed)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    // Not deflate data, or cut short.
    return null
  }
  const out = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

/**
 * The bytes of one file of a zip, or null when they are not what the zip's
 * directory says: more or fewer bytes than listed, another checksum, or
 * records that point outside the zip.
 */
export async function unpackEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
): Promise<Uint8Array | null> {
  const packed = packedBytes(bytes, entry)
  if (!packed) return null
  const unpacked =
    entry.method === 0 ? packed : await inflate(packed, entry.size)
  return unpacked &&
    unpacked.byteLength === entry.size &&
    crc32(unpacked) === entry.crc32
    ? unpacked
    : null
}
