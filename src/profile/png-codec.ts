const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

/** The CRC-32 a PNG chunk carries. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

async function pipe(
  data: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter()
  void writer.write(data as BufferSource).catch(() => {})
  void writer.close().catch(() => {})
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}

/** zlib-compresses (what a PNG's IDAT holds). */
export const deflate = (data: Uint8Array) =>
  pipe(data, new CompressionStream('deflate'))

/** zlib-decompresses; null when the data is broken. */
export const inflate = (data: Uint8Array) =>
  pipe(data, new DecompressionStream('deflate')).catch(() => null)
