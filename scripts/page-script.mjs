// Adds Slide's page script to the HTML an author uploads. Pure: bytes in,
// bytes out; the files on disk are never changed.

/** The script a slide loads so the viewer knows which page is on screen. */
export const PAGE_SCRIPT_SRC = '/_preview/pages.js'
const TAG = `<script src="${PAGE_SCRIPT_SRC}"></script>`

/** Parses SLIDE_PAGE_SCRIPT: empty or true adds the script, false leaves files as built. */
export function parsePageScript(value) {
  if (value === undefined || value === '' || value === 'true') return true
  if (value === 'false') return false
  throw new Error('SLIDE_PAGE_SCRIPT must be true, false, or empty')
}

const isHtml = (path) => /\.html?$/i.test(path)
const OTHER_CHARSET = /<meta[^>]+charset\s*=\s*["']?(?!utf-?8\b)[\w-]+/i

/**
 * The bytes to send for `path`. An HTML file gets the script tag at the end
 * of its head, so it runs before the slide's own scripts change the address;
 * a file with no head gets it at the end of its body, or of the file. A file
 * that already loads the script, is not UTF-8, or declares another charset
 * is sent as built: rewriting it could corrupt its text.
 */
export function withPageScript(path, bytes) {
  if (!isHtml(path)) return bytes
  let html
  try {
    html = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes,
    )
  } catch {
    return bytes
  }
  if (html.includes(PAGE_SCRIPT_SRC) || OTHER_CHARSET.test(html)) return bytes
  const at = [/<\/head\s*>/i, /<\/body\s*>/i]
    .map((closing) => closing.exec(html)?.index)
    .find((index) => index !== undefined)
  const position = at ?? html.length
  return Buffer.from(html.slice(0, position) + TAG + html.slice(position))
}
