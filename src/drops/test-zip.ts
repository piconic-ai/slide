import { deflateRawSync } from 'node:zlib'
import { crc32 } from './zip'

export type ZipFixtureEntry = Readonly<{
  /** Bytes instead of text make a name that is not UTF-8. */
  name: string | Uint8Array
  data?: string | Uint8Array
  /** 0 stores the file as it is; 8, the default, deflates it. */
  method?: number
  /** Values written into the records in place of the true ones. */
  forge?: Readonly<{
    size?: number
    compressedSize?: number
    crc32?: number
    flags?: number
    offset?: number
  }>
}>

const bytesOf = (value: string | Uint8Array) =>
  typeof value === 'string' ? new TextEncoder().encode(value) : value

/** Builds a zip in memory, true or forged, for tests of the reader. */
export function makeZip(
  entries: readonly ZipFixtureEntry[],
  options: Readonly<{ comment?: string; count?: number }> = {},
): Uint8Array {
  const locals: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(bytesOf(entry.name))
    const data = Buffer.from(bytesOf(entry.data ?? ''))
    const method = entry.method ?? 8
    const packed = method === 8 ? deflateRawSync(data) : data
    const size = entry.forge?.size ?? data.length
    const compressedSize = entry.forge?.compressedSize ?? packed.length
    const checksum = entry.forge?.crc32 ?? crc32(data)
    // Bit 11 says the name is UTF-8.
    const flags = entry.forge?.flags ?? 0x0800
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(compressedSize, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, packed)
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(20, 4)
    record.writeUInt16LE(20, 6)
    record.writeUInt16LE(flags, 8)
    record.writeUInt16LE(method, 10)
    record.writeUInt32LE(checksum, 16)
    record.writeUInt32LE(compressedSize, 20)
    record.writeUInt32LE(size, 24)
    record.writeUInt16LE(name.length, 28)
    record.writeUInt32LE(entry.forge?.offset ?? offset, 42)
    directory.push(record, name)
    offset += local.length + name.length + packed.length
  }
  const central = Buffer.concat(directory)
  const comment = Buffer.from(options.comment ?? '')
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(options.count ?? entries.length, 8)
  end.writeUInt16LE(options.count ?? entries.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(comment.length, 20)
  return new Uint8Array(Buffer.concat([...locals, central, end, comment]))
}
