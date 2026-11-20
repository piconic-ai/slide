/**
 * Which paths a slide's files may have. Kept free of other modules, so the
 * sender in the browser refuses a file by the same rule as the service,
 * before it sends anything, and can say which file it is.
 */

/** How long a path may be, in UTF-8 bytes. */
export const MAX_UPLOAD_PATH_BYTES = 512

const encoder = new TextEncoder()

/** Whether one segment of a path, a folder's or the file's name, is allowed. */
const isAllowedSegment = (segment: string): boolean =>
  segment.length > 0 &&
  !segment.startsWith('.') &&
  !/^(?:node_modules|__MACOSX|_worker\.js|_routes\.json)$/i.test(segment) &&
  !/^(?:credentials|secrets)(?:\.|$)/i.test(segment) &&
  !/\.(?:php\d*|phtml|phar|cgi|pl|py|rb|sh|bash|exe|dll|asp|aspx|jsp)(?:\.|$)/i.test(
    segment,
  )

/**
 * Whether a path, already in NFC, may name a file of a slide: not empty or
 * too long, not under the service's own `_preview`, without characters that
 * a URL or a file system reads specially, and made of allowed segments.
 */
export function isUploadPath(path: string): boolean {
  if (!path || encoder.encode(path).byteLength > MAX_UPLOAD_PATH_BYTES)
    return false
  if (path.split('/')[0] === '_preview') return false
  if (/[\\\u0000-\u001f\u007f-\u009f%?#:]|\p{Surrogate}|\p{Cf}/u.test(path))
    return false
  return path.split('/').every(isAllowedSegment)
}

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
