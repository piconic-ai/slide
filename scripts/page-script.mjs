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
const STARTS_A_DOCUMENT =
  /^﻿?\s*(?:<!--[\s\S]*?-->\s*)*<(?:!doctype\s+html|html)\b/i
const ATTRIBUTE =
  /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
/** A start tag's attributes by lowercase name; the first of a name counts. */
function attributesOf(text) {
  const attributes = new Map()
  for (const [, name, double, single, bare] of text.matchAll(ATTRIBUTE)) {
    const key = name.toLowerCase()
    if (!attributes.has(key))
      attributes.set(key, double ?? single ?? bare ?? '')
  }
  return attributes
}

// A comment, or a tag with its attributes; a quoted value may hold `>`.
const TOKEN = `<!--[\\s\\S]*?(?:-->|$)|<(/?)([a-z][a-z0-9]*)\\b((?:"[^"]*"|'[^']*'|[^>"'])*)>`
// Elements whose content is text up to their own end tag, whatever it spells.
const TEXT_ONLY = new Set([
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noscript',
  'noembed',
  'noframes',
])

/** Where the text of `name`, which starts at `from`, ends. */
function afterText(html, name, from) {
  const end = new RegExp(`</${name}\\s*>`, 'gi')
  end.lastIndex = from
  return end.exec(html) ? end.lastIndex : html.length
}

/** Whether a start tag of the document itself loads the script. */
const loadsIt = (name, text) =>
  name === 'script' &&
  (attributesOf(text).get('src') ?? '').trim().startsWith(PAGE_SCRIPT_SRC)

/** Notes a tag of the document itself: one outside every template. */
function noteTag(found, closing, name, text, index) {
  if (!closing) found.loads ||= loadsIt(name, text)
  else if (name === 'head' || name === 'body') found[name] ??= index
}

/**
 * Reads the document's own markup: where its head and body close, and
 * whether it already loads the script. Comments, the text of scripts and the like, and everything inside a
 * template are not the document's own, whatever tags they spell.
 */
function readMarkup(html) {
  const found = { loads: false }
  const token = new RegExp(TOKEN, 'gi')
  let templates = 0
  for (let match = token.exec(html); match; match = token.exec(html)) {
    // A comment has no tag name.
    if (match[2] === undefined) continue
    const name = match[2].toLowerCase()
    const closing = match[1] === '/'
    if (name === 'template')
      templates = Math.max(0, templates + (closing ? -1 : 1))
    else if (!closing && TEXT_ONLY.has(name))
      token.lastIndex = afterText(html, name, token.lastIndex)
    if (templates === 0) noteTag(found, closing, name, match[3], match.index)
  }
  return found
}

// Encodings that spell a character with bytes an ASCII tag also uses: UTF-16
// and UTF-32 show a NUL, the ISO-2022 family an escape.
const NOT_ASCII_COMPATIBLE = [0x00, 0x1b]

/**
 * The bytes to send for `path`. An HTML document gets the script tag at the
 * end of its head, so it runs before the slide's own scripts change the
 * address; one that leaves `</head>` out gets it at the end of its body, or
 * of the file. These are sent as built: a file that is not HTML, a piece of
 * HTML that is not a document (a slide may insert it into a page), a file
 * that already loads the script, and a file whose bytes are not UTF-8.
 *
 * What charset the file declares is not read. The tag is ASCII and goes
 * where the file has an ASCII `<`, a byte that Shift_JIS, EUC and the other
 * ASCII-compatible encodings in use never put inside a character, so the
 * bytes around it mean what they meant. (Johab, long obsolete, does; its
 * text would also have to pass for UTF-8 to get here.)
 */
export function withPageScript(path, bytes) {
  if (
    !isHtml(path) ||
    NOT_ASCII_COMPATIBLE.some((byte) => bytes.includes(byte))
  )
    return bytes
  let html
  try {
    html = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes,
    )
  } catch {
    return bytes
  }
  const { head, body, loads } = readMarkup(html)
  if (loads) return bytes
  if (head === undefined && body === undefined && !STARTS_A_DOCUMENT.test(html))
    return bytes
  const position = head ?? body ?? html.length
  // TextEncoder, not Buffer: the browser's sender runs this too.
  return new TextEncoder().encode(
    html.slice(0, position) + TAG + html.slice(position),
  )
}
