import { withPageScript } from '../../scripts/page-script.mjs'
import {
  parseInventoryStructure,
  type UploadInventory,
} from '../uploads/inventory'

/** The most text, in UTF-8 bytes, a tool takes in its arguments (D-62). */
export const MAX_ARGUMENT_BYTES = 1024 * 1024
/** More files than any version may hold are not even measured. */
export const MAX_ARGUMENT_FILES = 500

/** A file as an agent passes it in a tool's arguments. */
export type TextFile = Readonly<{ path: string; text: string }>
export type PreparedFiles =
  | Readonly<{
      ok: true
      inventory: UploadInventory
      /** The bytes of each file, by the path the inventory names it with. */
      bytes: ReadonlyMap<string, Uint8Array<ArrayBuffer>>
    }>
  | Readonly<{
      ok: false
      error: 'too_large_for_arguments' | 'invalid_files'
      message: string
    }>

const hex = (digest: ArrayBuffer) =>
  Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

const INVALID_FILES =
  'The files are not a set of static files the service takes. Send index.html at the top level, use plain relative paths without "..", hidden files or repeats, and only static web files (html, css, js, json, images, fonts, media).'
const blank = (path: string) => ({ path, size: 0, sha256: '0'.repeat(64) })

/** Whether the entries pass the checks every upload's inventory passes. */
function isInventory(entries: readonly ReturnType<typeof blank>[]): boolean {
  try {
    parseInventoryStructure({ entry: 'index.html', files: entries })
    return true
  } catch {
    return false
  }
}

const invalid = (message: string): PreparedFiles => ({
  ok: false,
  error: 'invalid_files',
  message,
})

/**
 * Turns the text files of a tool call into what the upload takes: bytes
 * with the page script added to each HTML document, as the uploader script
 * and the browser add it, and an inventory of their sizes and hashes that
 * has passed the same path checks as any upload. Nothing here trusts the
 * agent: a path that climbs out, repeats, or names a kind of file the
 * service does not serve is refused with the reason.
 */
export async function prepareTextFiles(
  files: readonly TextFile[],
): Promise<PreparedFiles> {
  if (files.length > MAX_ARGUMENT_FILES)
    return invalid(`Too many files: at most ${MAX_ARGUMENT_FILES} are read`)
  // Paths are judged before any content is read: a placeholder inventory
  // goes through the same checks the real one will.
  const paths = files.map((file) => file.path.normalize('NFC'))
  if (new Set(paths).size !== paths.length || !isInventory(paths.map(blank)))
    return invalid(INVALID_FILES)
  const encoder = new TextEncoder()
  const bytes = new Map<string, Uint8Array<ArrayBuffer>>()
  let total = 0
  for (const [index, file] of files.entries()) {
    const encoded = encoder.encode(file.text)
    total += encoded.byteLength
    if (total > MAX_ARGUMENT_BYTES)
      return {
        ok: false,
        error: 'too_large_for_arguments',
        message: `The files hold more than ${MAX_ARGUMENT_BYTES} bytes of text, the most a call may carry. Call begin_upload instead: it returns where to send each file over HTTP, and finish_upload completes it.`,
      }
    const path = paths[index] ?? ''
    // Copied into an array of its own, as hashing and sending ask for.
    bytes.set(path, new Uint8Array(withPageScript(path, encoded)))
  }
  const entries = await Promise.all(
    [...bytes].map(async ([path, sent]) => ({
      path,
      size: sent.byteLength,
      sha256: hex(await crypto.subtle.digest('SHA-256', sent)),
    })),
  )
  try {
    return {
      ok: true,
      inventory: parseInventoryStructure({
        entry: 'index.html',
        files: entries,
      }),
      bytes,
    }
  } catch {
    return invalid(INVALID_FILES)
  }
}
