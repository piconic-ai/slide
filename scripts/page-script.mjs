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
const LOADS_IT = /<script\b[^>]*\bsrc\s*=\s*["']?\/_preview\/pages\.js/i
const STARTS_A_DOCUMENT =
  /^﻿?\s*(?:<!--[\s\S]*?-->\s*)*<(?:!doctype\s+html|html)\b/i

// Attributes of a start tag; a quoted value may hold `>`.
const ATTRS = `(?:"[^"]*"|'[^']*'|[^>"'])*`
// Walks the markup in order. Comments, and elements whose content is text or
// is kept apart (a script's string may spell </head>), are stepped over, as
// is every other start tag with its quoted attributes.
const MARKUP = new RegExp(
  [
    '<!--[\\s\\S]*?(?:-->|$)',
    `<(script|style|textarea|title|template|noscript|iframe|xmp)\\b${ATTRS}>[\\s\\S]*?(?:</\\1\\s*>|$)`,
    '</(head|body)\\s*>',
    `<[a-z]${ATTRS}>`,
  ].join('|'),
  'gi',
)

/** Where the document's own head and body close, if it says so. */
function closings(html) {
  const found = {}
  for (const match of html.matchAll(MARKUP)) {
    const name = match[2]?.toLowerCase()
    if (name && found[name] === undefined) found[name] = match.index
  }
  return found
}

/**
 * The bytes to send for `path`. An HTML document gets the script tag at the
 * end of its head, so it runs before the slide's own scripts change the
 * address; one that leaves `</head>` out gets it at the end of its body, or
 * of the file. These are sent as built: a file that is not HTML, a piece of
 * HTML that is not a document (a slide may insert it into a page), a file
 * that already loads the script, and a file that is not UTF-8 or declares
 * another charset, since rewriting it could corrupt its text.
 */
export function withPageScript(path, bytes) {
  // UTF-16 without a byte order mark can pass for UTF-8; its NULs give it away.
  if (!isHtml(path) || bytes.includes(0)) return bytes
  let html
  try {
    html = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes,
    )
  } catch {
    return bytes
  }
  if (LOADS_IT.test(html) || OTHER_CHARSET.test(html)) return bytes
  const { head, body } = closings(html)
  if (head === undefined && body === undefined && !STARTS_A_DOCUMENT.test(html))
    return bytes
  const position = head ?? body ?? html.length
  return Buffer.from(html.slice(0, position) + TAG + html.slice(position))
}
