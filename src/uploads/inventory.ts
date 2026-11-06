import { z } from 'zod'
import { DEFAULT_UPLOAD_LIMITS, type UploadLimits } from './limits'

export const MAX_INVENTORY_METADATA_BYTES = 128 * 1024
export const MAX_UPLOAD_PATH_BYTES = 512

const mediaTypes: Readonly<Record<string, string>> = Object.freeze({
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json',
  map: 'application/json',
  txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogg: 'audio/ogg',
  wasm: 'application/wasm',
  pdf: 'application/pdf',
})
const encoder = new TextEncoder()
const pathSchema = z
  .string()
  .transform((path) => path.normalize('NFC'))
  .refine(
    (path) => {
      if (!path || encoder.encode(path).byteLength > MAX_UPLOAD_PATH_BYTES)
        return false
      if (/[\\\u0000-\u001f\u007f-\u009f%?#:]|\p{Surrogate}|\p{Cf}/u.test(path))
        return false
      return path
        .split('/')
        .every(
          (segment) =>
            segment.length > 0 &&
            !segment.startsWith('.') &&
            !/^(?:node_modules|__MACOSX|_worker\.js|_routes\.json)$/i.test(
              segment,
            ) &&
            !/^(?:credentials|secrets)(?:\.|$)/i.test(segment) &&
            !/\.(?:php\d*|phtml|phar|cgi|pl|py|rb|sh|bash|exe|dll|asp|aspx|jsp)(?:\.|$)/i.test(
              segment,
            ),
        )
    },
    { message: 'Invalid static upload path' },
  )
  .brand<'UploadPath'>()
const hashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .brand<'FileSha256'>()
const fileSchema = z.strictObject({
  path: pathSchema,
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: hashSchema,
})
const inventorySchema = z.strictObject({
  entry: z.literal('index.html'),
  files: z.array(fileSchema).min(1),
})

export type UploadPath = z.infer<typeof pathSchema>
export type FileSha256 = z.infer<typeof hashSchema>
export type UploadFile = Readonly<
  z.infer<typeof fileSchema> & { mediaType: string }
>
export type UploadInventory = Readonly<{
  entry: 'index.html'
  files: readonly UploadFile[]
  totalBytes: number
}>

export function parseUploadInventory(
  input: unknown,
  limits: UploadLimits = DEFAULT_UPLOAD_LIMITS,
): UploadInventory {
  const inventory = inventorySchema.parse(input)
  if (inventory.files.length > limits.files)
    throw new Error('Too many upload files')
  const paths = new Set<string>()
  let totalBytes = 0
  const files = inventory.files.map((file) => {
    if (paths.has(file.path)) throw new Error('Duplicate upload path')
    paths.add(file.path)
    const extension = /\.([^./]+)$/.exec(file.path)?.[1]?.toLowerCase() ?? ''
    const mediaType = Object.hasOwn(mediaTypes, extension)
      ? mediaTypes[extension]
      : undefined
    if (!mediaType) throw new Error('Unsupported static file type')
    if (file.size > limits.fileBytes)
      throw new Error('Upload file exceeds byte limit')
    if (file.size > limits.deploymentBytes - totalBytes) {
      throw new Error('Upload inventory exceeds byte limit')
    }
    totalBytes += file.size
    return Object.freeze({ ...file, mediaType })
  })
  if (!paths.has(inventory.entry)) throw new Error('Missing index.html entry')
  for (const path of paths) {
    const segments = path.split('/')
    for (let end = 1; end < segments.length; end++) {
      if (paths.has(segments.slice(0, end).join('/')))
        throw new Error('File/directory collision')
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return Object.freeze({
    entry: inventory.entry,
    files: Object.freeze(files),
    totalBytes,
  })
}

export async function digestUploadInventory(
  inventory: UploadInventory,
): Promise<string> {
  const canonical = JSON.stringify({
    entry: inventory.entry,
    files: inventory.files.map(({ path, size, sha256 }) => ({
      path,
      size,
      sha256,
    })),
  })
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(canonical),
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
