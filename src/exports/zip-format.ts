// The records of a zip file, written as bytes. Pure. See zip-plan.ts for why
// the entries are stored with a data descriptor.
import {
  DATA_DESCRIPTOR_BYTES,
  DIRECTORY_ENTRY_BYTES,
  END_RECORD_BYTES,
  LOCAL_HEADER_BYTES,
  type PlannedEntry,
  type ZipPlan,
} from './zip-plan'

/**
 * Bit 3: the checksum and sizes follow the file's bytes. Bit 11: the name is
 * UTF-8.
 */
const FLAGS = 0x0808
/** Version needed to extract: 2.0, which has the data descriptor. */
const VERSION_NEEDED = 20
/**
 * Version made by: 2.0 on UNIX (host 3). Info-ZIP's unzip, the tool most
 * Linux and macOS users have, decodes a name as UTF-8 (flag bit 11) only for
 * a UNIX host; for an MS-DOS host it reads the bytes as an old code page and
 * garbles Japanese names.
 */
const VERSION_MADE_BY = (3 << 8) | 20
/**
 * The mode every entry carries: a regular file, readable by all and writable
 * by its owner (0644), in the high half of the external attributes. The type
 * bits say "regular file", so no entry can extract as a link, a device or a
 * program.
 */
const EXTERNAL_ATTRIBUTES = (0o100644 << 16) >>> 0

export function localHeader(plan: ZipPlan, entry: PlannedEntry): Uint8Array {
  const bytes = new Uint8Array(LOCAL_HEADER_BYTES + entry.nameBytes.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x04034b50, true)
  view.setUint16(4, VERSION_NEEDED, true)
  view.setUint16(6, FLAGS, true)
  view.setUint16(8, 0, true) // stored
  view.setUint16(10, plan.dosTime, true)
  view.setUint16(12, plan.dosDate, true)
  // Checksum and sizes are zero here; the data descriptor has them.
  view.setUint16(26, entry.nameBytes.length, true)
  bytes.set(entry.nameBytes, LOCAL_HEADER_BYTES)
  return bytes
}

export function dataDescriptor(crc32: number, size: number): Uint8Array {
  const bytes = new Uint8Array(DATA_DESCRIPTOR_BYTES)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x08074b50, true)
  view.setUint32(4, crc32, true)
  view.setUint32(8, size, true)
  view.setUint32(12, size, true)
  return bytes
}

/**
 * The central directory and the record that ends the zip, from the
 * checksums read while the files went by (one per entry, in order).
 */
export function directoryAndEnd(
  plan: ZipPlan,
  checksums: readonly number[],
): Uint8Array {
  const directoryLength = plan.length - plan.directoryOffset
  const bytes = new Uint8Array(directoryLength)
  const view = new DataView(bytes.buffer)
  let at = 0
  plan.entries.forEach((entry, index) => {
    view.setUint32(at, 0x02014b50, true)
    view.setUint16(at + 4, VERSION_MADE_BY, true)
    view.setUint16(at + 6, VERSION_NEEDED, true)
    view.setUint16(at + 8, FLAGS, true)
    view.setUint16(at + 10, 0, true)
    view.setUint16(at + 12, plan.dosTime, true)
    view.setUint16(at + 14, plan.dosDate, true)
    view.setUint32(at + 16, checksums[index] ?? 0, true)
    view.setUint32(at + 20, entry.size, true)
    view.setUint32(at + 24, entry.size, true)
    view.setUint16(at + 28, entry.nameBytes.length, true)
    // Extra, comment, disk and internal attributes: all zero.
    view.setUint32(at + 38, EXTERNAL_ATTRIBUTES, true)
    view.setUint32(at + 42, entry.offset, true)
    bytes.set(entry.nameBytes, at + DIRECTORY_ENTRY_BYTES)
    at += DIRECTORY_ENTRY_BYTES + entry.nameBytes.length
  })
  view.setUint32(at, 0x06054b50, true)
  view.setUint16(at + 8, plan.entries.length, true)
  view.setUint16(at + 10, plan.entries.length, true)
  view.setUint32(at + 12, at, true)
  view.setUint32(at + 16, plan.directoryOffset, true)
  if (at + END_RECORD_BYTES !== directoryLength)
    throw new Error('Zip plan and directory disagree on length')
  return bytes
}
