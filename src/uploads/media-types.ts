/**
 * The kinds of file a slide may hold, by extension, with the type each is
 * served as. Kept free of other modules, so the sender in the browser can
 * refuse a file with the same list before sending it.
 */
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

/** The type a file of this path is served as, or null for a kind not taken. */
export function mediaTypeOfPath(path: string): string | null {
  const extension = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
  return Object.hasOwn(mediaTypes, extension)
    ? (mediaTypes[extension] ?? null)
    : null
}
