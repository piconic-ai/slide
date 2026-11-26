// What may be the name of a file inside an exported zip, and what the zip
// itself is called. Pure.

/** The longest name a zip record can hold, in UTF-8 bytes. */
export const MAX_ZIP_NAME_BYTES = 0xffff

export type ZipNameProblem =
  | 'empty'
  | 'too_long'
  /** An empty segment: a leading `/` (absolute path) or `//`. */
  | 'absolute_or_empty_segment'
  | 'dot_segment'
  | 'backslash'
  | 'control_character'
  | 'drive'
  | 'not_normalized'

const encoder = new TextEncoder()

/**
 * Why a path may not be the name of an entry, or null when it may. An
 * extractor joins the name to a folder, so a name must stay inside it: no
 * `..` or `.` segment, no absolute path, no backslash (a separator on
 * Windows), no drive letter, no control character. This is the same rule
 * the service applies when it reads a zip of slides (`src/drops/zip.ts`), so
 * what it writes is what it would accept. Upload rules already keep such
 * paths out of storage; this checks again at the point where a wrong name
 * would reach someone's disk.
 */
export function zipNameProblem(path: string): ZipNameProblem | null {
  if (path === '') return 'empty'
  if (encoder.encode(path).byteLength > MAX_ZIP_NAME_BYTES) return 'too_long'
  if (path.includes('\\')) return 'backslash'
  if (/[\u0000-\u001f\u007f]/.test(path)) return 'control_character'
  if (/^[A-Za-z]:/.test(path)) return 'drive'
  // The service stores paths in NFC; a name in another form would not be
  // the name the author put the file under.
  if (path !== path.normalize('NFC')) return 'not_normalized'
  const segments = path.split('/')
  if (segments.some((segment) => segment === '.' || segment === '..'))
    return 'dot_segment'
  if (segments.some((segment) => segment === ''))
    return 'absolute_or_empty_segment'
  return null
}

const FILENAME_PART = /[^a-z0-9-]/g

/** `YYYYMMDD` of a time in seconds, in UTC. */
const dayOf = (seconds: number) =>
  new Date(seconds * 1000).toISOString().slice(0, 10).replaceAll('-', '')

/**
 * The name a downloaded zip is saved under: the slide's URL name, the day
 * the version was received, and the start of the version's ID, so two
 * versions of one slide never share a name. Only ASCII letters, digits and
 * hyphens come out, so it is safe in a header and as a file name.
 */
export function zipFileName(
  input: Readonly<{ slug: string; deploymentId: string; readyAt: number }>,
): string {
  const slug = input.slug.toLowerCase().replace(FILENAME_PART, '-')
  const id = input.deploymentId.toLowerCase().replace(FILENAME_PART, '')
  return `${slug || 'slide'}-${dayOf(input.readyAt)}-${id.slice(0, 8) || 'version'}.zip`
}
