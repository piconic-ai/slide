// Which files of a slide one answer of get_slide_files holds, and how the
// next answer picks up. Pure.
import { z } from 'zod'

/** The most files one answer lists, over both versions. */
export const FILES_PAGE_SIZE = 100
/** Nothing longer than this is read as a cursor. */
export const MAX_CURSOR_LENGTH = 1500

/** The versions a slide exports, in the order they are listed. */
export type ExportRole = 'published' | 'prepared'

/** Where the next answer starts: after this file of this version. */
export type Cursor = Readonly<{
  role: ExportRole
  deploymentId: string
  /** The last path listed. Matched exactly, so no ordering of text is needed. */
  after: string
}>

export type PagedVersion<File extends Readonly<{ path: string }>> = Readonly<{
  role: ExportRole
  deploymentId: string
  /** In the order they are listed, which is the order of their paths. */
  files: readonly File[]
}>

export type Page<File> =
  | Readonly<{
      kind: 'page'
      /** Versions with at least one file in this answer, in order. */
      slices: readonly Readonly<{
        role: ExportRole
        deploymentId: string
        files: readonly File[]
      }>[]
      next: Cursor | null
    }>
  /** The cursor names a version or a file this slide no longer has. */
  | Readonly<{ kind: 'stale' }>

const encoder = new TextEncoder()
const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

const cursorSchema = z.object({
  r: z.enum(['published', 'prepared']),
  d: z.string().max(100),
  a: z.string().max(1024),
})

/** The cursor as the opaque text an agent hands back. */
export const encodeCursor = (cursor: Cursor): string =>
  toBase64Url(
    encoder.encode(
      JSON.stringify({
        r: cursor.role,
        d: cursor.deploymentId,
        a: cursor.after,
      }),
    ),
  )

/** The cursor in text an agent handed back, or null when it is not one. */
export function decodeCursor(text: string): Cursor | null {
  if (text.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(text))
    return null
  try {
    const bytes = Uint8Array.from(
      atob(text.replaceAll('-', '+').replaceAll('_', '/')),
      (char) => char.charCodeAt(0),
    )
    const parsed = cursorSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    )
    return { role: parsed.r, deploymentId: parsed.d, after: parsed.a }
  } catch {
    return null
  }
}

/**
 * The files of one answer: up to `size` of them after the cursor, walking
 * the versions in order and each version's files in order. Versions never
 * change once received, so a cursor stays good as long as the version it
 * names is still one of the slide's exported versions.
 */
export function pageOf<File extends Readonly<{ path: string }>>(
  versions: readonly PagedVersion<File>[],
  cursor: Cursor | null,
  size: number = FILES_PAGE_SIZE,
): Page<File> {
  let firstVersion = 0
  let firstFile = 0
  if (cursor) {
    firstVersion = versions.findIndex(({ role }) => role === cursor.role)
    const version = versions[firstVersion]
    if (!version || version.deploymentId !== cursor.deploymentId)
      return { kind: 'stale' }
    const index = version.files.findIndex(({ path }) => path === cursor.after)
    if (index < 0) return { kind: 'stale' }
    firstFile = index + 1
  }
  const slices: {
    role: ExportRole
    deploymentId: string
    files: readonly File[]
  }[] = []
  let left = size
  let last: Cursor | null = null
  let remaining = 0
  versions.slice(firstVersion).forEach((version, offset) => {
    const from = offset === 0 ? firstFile : 0
    const taken = version.files.slice(from, from + Math.max(left, 0))
    remaining += version.files.length - from - taken.length
    left -= taken.length
    const end = taken.at(-1)
    if (!end) return
    slices.push({
      role: version.role,
      deploymentId: version.deploymentId,
      files: taken,
    })
    last = {
      role: version.role,
      deploymentId: version.deploymentId,
      after: end.path,
    }
  })
  return { kind: 'page', slices, next: remaining > 0 ? last : null }
}
