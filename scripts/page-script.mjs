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

// The start of a tag, up to its name; its attributes follow.
const TAG_START = /<(\/?)([a-z][a-z0-9]*)\b/iy
const GREATER_THAN = 62
const DOUBLE_QUOTE = 34
const SINGLE_QUOTE = 39

/** The quote state after `code`: 0 outside a value, else the quote it is in. */
function quoteAfter(quote, code) {
  if (quote === 0)
    return code === DOUBLE_QUOTE || code === SINGLE_QUOTE ? code : 0
  return code === quote ? 0 : quote
}

/**
 * Finds where tags close: the first `>` outside a quoted value, as a quoted
 * value may hold `>`. A tag left open is read to the end of the file only
 * once per quote state: every later tag whose reading falls in with that
 * one is known to be open too. So a file of unclosed tags, which a document
 * never is but an upload may be, costs one pass and not one per tag.
 */
function tagEnds(html) {
  // Per position, the quote states from which no `>` closes a tag.
  let open
  const bit = (quote) => (quote === 0 ? 1 : quote === DOUBLE_QUOTE ? 2 : 4)
  const walk = (from, mark) => {
    let quote = 0
    for (let at = from; at < html.length; at++) {
      if (open && open[at] & bit(quote)) return -1
      if (mark) open[at] |= bit(quote)
      const code = html.charCodeAt(at)
      if (quote === 0 && code === GREATER_THAN) return at
      quote = quoteAfter(quote, code)
    }
    return -1
  }
  /** The index of the `>` closing a tag whose attributes start at `from`, or -1. */
  return (from) => {
    const end = walk(from, false)
    if (end === -1) {
      open ??= new Uint8Array(html.length)
      walk(from, true)
    }
    return end
  }
}

/**
 * The token that starts at the `<` at `at`: a comment, or a tag with its
 * attributes. Null when the `<` starts neither. An unclosed comment runs to
 * the end of the file.
 */
function tokenAt(html, at, endOfTag) {
  if (html.startsWith('<!--', at)) {
    const close = html.indexOf('-->', at + 4)
    return { end: close === -1 ? html.length : close + 3 }
  }
  TAG_START.lastIndex = at
  const start = TAG_START.exec(html)
  if (!start) return null
  const close = endOfTag(TAG_START.lastIndex)
  if (close === -1) return null
  return {
    end: close + 1,
    closing: start[1] === '/',
    name: start[2].toLowerCase(),
    text: html.slice(TAG_START.lastIndex, close),
  }
}
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
  const endOfTag = tagEnds(html)
  const depth = { templates: 0 }
  let at = html.indexOf('<')
  while (at !== -1) {
    const token = tokenAt(html, at, endOfTag)
    at = html.indexOf('<', readToken(html, at, token, found, depth))
  }
  return found
}

/** Notes the token at `at`, if any, and gives where reading goes on. */
function readToken(html, at, token, found, depth) {
  if (!token) return at + 1
  // A comment has no tag name.
  if (token.name === undefined) return token.end
  const { closing, name, text } = token
  let next = token.end
  if (name === 'template')
    depth.templates = Math.max(0, depth.templates + (closing ? -1 : 1))
  else if (!closing && TEXT_ONLY.has(name)) next = afterText(html, name, next)
  if (depth.templates === 0) noteTag(found, closing, name, text, at)
  return next
}

/**
 * Whether an HTML document's own markup loads the script. The service asks
 * this of a received index.html, so it reads what the uploader reads.
 */
export const loadsPageScript = (html) => readMarkup(html).loads

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
