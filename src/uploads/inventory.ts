import { z } from 'zod'
import { mediaTypeOfPath } from './media-types'
import { fileFolderCollision, isUploadPath } from './path-rules'

export const MAX_INVENTORY_METADATA_BYTES = 128 * 1024
export { MAX_UPLOAD_PATH_BYTES } from './path-rules'

const encoder = new TextEncoder()
const pathSchema = z
  .string()
  .transform((path) => path.normalize('NFC'))
  .refine(isUploadPath, { message: 'Invalid static upload path' })
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

function mediaTypeOf(path: string) {
  const mediaType = mediaTypeOfPath(path)
  if (!mediaType) throw new Error('Unsupported static file type')
  return mediaType
}

/** Parses the inventory shape and paths without applying configured limits. */
export function parseInventoryStructure(input: unknown): UploadInventory {
  const inventory = inventorySchema.parse(input)
  const paths = new Set<string>()
  let totalBytes = 0
  const files = inventory.files.map((file) => {
    if (paths.has(file.path)) throw new Error('Duplicate upload path')
    paths.add(file.path)
    // The total is stored as an integer, so it must stay exact.
    if (file.size > Number.MAX_SAFE_INTEGER - totalBytes)
      throw new Error('Upload inventory total is too large')
    totalBytes += file.size
    return Object.freeze({ ...file, mediaType: mediaTypeOf(file.path) })
  })
  if (!paths.has(inventory.entry)) throw new Error('Missing index.html entry')
  if (fileFolderCollision(paths) !== null)
    throw new Error('File/directory collision')
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
