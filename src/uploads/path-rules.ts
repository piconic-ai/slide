/**
 * Which paths a slide's files may have. Kept free of other modules, so the
 * sender in the browser refuses a file by the same rule as the service,
 * before it sends anything, and can say which file it is.
 */

/** How long a path may be, in UTF-8 bytes. */
export const MAX_UPLOAD_PATH_BYTES = 512

const encoder = new TextEncoder()

/** Why a path may not name a file of a slide, for saying it to the author. */
export type PathProblem =
  /** Nothing, or longer than MAX_UPLOAD_PATH_BYTES. */
  | 'length'
  /** Under `_preview`, which the service serves itself. */
  | 'reserved_folder'
  /** A character a URL or a file system reads specially. */
  | 'character'
  /** A name that starts with a dot, or an empty one. */
  | 'hidden'
  /** A name the service keeps out: node_modules, credentials, and the like. */
  | 'reserved_name'
  /** An extension of something a server might run. */
  | 'program'

const RESERVED_NAME =
  /^(?:node_modules|__MACOSX|_worker\.js|_routes\.json)$|^(?:credentials|secrets)(?:\.|$)/i
const PROGRAM =
  /\.(?:php\d*|phtml|phar|cgi|pl|py|rb|sh|bash|exe|dll|asp|aspx|jsp)(?:\.|$)/i

/** What is wrong with one segment of a path, a folder's or the file's name. */
function segmentProblem(segment: string): PathProblem | null {
  if (segment.length === 0 || segment.startsWith('.')) return 'hidden'
  if (RESERVED_NAME.test(segment)) return 'reserved_name'
  return PROGRAM.test(segment) ? 'program' : null
}

/**
 * What keeps a path, already in NFC, from naming a file of a slide, or null
 * when nothing does: it is not empty or too long, not under the service's
 * own `_preview`, has no character a URL or a file system reads specially,
 * and is made of allowed segments.
 */
export function uploadPathProblem(path: string): PathProblem | null {
  if (!path || encoder.encode(path).byteLength > MAX_UPLOAD_PATH_BYTES)
    return 'length'
  if (path.split('/')[0] === '_preview') return 'reserved_folder'
  if (/[\\\u0000-\u001f\u007f-\u009f%?#:]|\p{Surrogate}|\p{Cf}/u.test(path))
    return 'character'
  for (const segment of path.split('/')) {
    const problem = segmentProblem(segment)
    if (problem) return problem
  }
  return null
}

/** Whether a path, already in NFC, may name a file of a slide. */
export const isUploadPath = (path: string): boolean =>
  uploadPathProblem(path) === null

/**
 * A path that is both a file and a folder of another file, as `a` beside
 * `a/b`, or null when there is none. Such a set cannot be served.
 */
export function fileFolderCollision(paths: ReadonlySet<string>): string | null {
  for (const path of paths) {
    const segments = path.split('/')
    for (let end = 1; end < segments.length; end++) {
      const folder = segments.slice(0, end).join('/')
      if (paths.has(folder)) return folder
    }
  }
  return null
}
