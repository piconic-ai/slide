import { decodeHTML } from 'entities'

/** Titles longer than this are cut, so one deck cannot stretch a list. */
export const TITLE_MAX_LENGTH = 200

/** How much of index.html is read for its title; <title> sits in <head>. */
export const TITLE_SCAN_BYTES = 64 * 1024

/**
 * The inside of a tag. Quoted attribute values may hold < or >, but an
 * unquoted < ends the attempt, so a stray < costs one short scan.
 */
export const TAG_BODY = String.raw`(?:"[^"]*"|'[^']*'|[^'"<>])*`

/**
 * A comment. `<!-->` and `<!--->` are whole, empty comments; an unclosed one
 * runs to the end of the input.
 */
export const COMMENT = String.raw`<!--(?:-?>|[\s\S]*?(?:-->|$))`

/**
 * Elements whose content is not the document's markup: raw text, or markup
 * that is not rendered as part of the page. Their content ends at their
 * first end tag.
 */
export const OPAQUE_ELEMENTS =
  'script|style|textarea|xmp|iframe|noembed|noframes|noscript'

/**
 * A start or end tag of <template>, capturing the slash of an end tag.
 * Templates nest, so their content is left out by counting depth.
 */
export const TEMPLATE_TAG = String.raw`<(\/?)template(?=[\s/>])${TAG_BODY}>`

/** The template depth after a template tag; a stray end tag changes nothing. */
export const templateDepth = (depth: number, slash: string) =>
  Math.max(0, depth + (slash ? -1 : 1))

/**
 * Decoded text as one line of plain text: whitespace collapsed, cut to `max`
 * characters without splitting a surrogate pair. Null when nothing visible
 * is left.
 */
export function plainText(decoded: string, max: number): string | null {
  const text = decoded.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim()
  if (!/[^\s\p{Cf}]/u.test(text)) return null
  return Array.from(text).slice(0, max).join('').trim()
}

/**
 * Tokens read in document order. Comments, raw-text elements and other tags
 * are consumed whole, and templates are followed by depth, so a <title> written inside them, or inside an
 * attribute value, is never taken for the document's. Title text is itself
 * plain text, so markup inside it is kept. Unclosed comments, raw text and
 * titles run to the end of the input, so no token is retried from later
 * starts.
 */
const TOKENS = new RegExp(
  [
    COMMENT,
    String.raw`<(${OPAQUE_ELEMENTS})(?=[\s/>])${TAG_BODY}>[\s\S]*?(?:<\/\1\s*>|$)`,
    String.raw`<title(?=[\s/>])${TAG_BODY}>([\s\S]*?)(<\/title\s*>|$)`,
    TEMPLATE_TAG,
    String.raw`<\/?[a-z][a-z0-9-]*(?=[\s/>])${TAG_BODY}>`,
  ].join('|'),
  'gi',
)

/**
 * The title an HTML document declares in its first <title>, with character
 * references decoded and whitespace collapsed, or null when it has none or
 * it is blank. The result is plain text; pages escape it when they render
 * it.
 */
export function titleOf(html: string): string | null {
  let content: string | undefined
  let depth = 0
  for (const token of html.matchAll(TOKENS)) {
    if (token[4] !== undefined) depth = templateDepth(depth, token[4])
    if (token[2] === undefined || depth > 0) continue
    // An unclosed title was cut by the scan limit or never ends.
    if (token[3]) content = token[2]
    break
  }
  return content ? plainText(decodeHTML(content), TITLE_MAX_LENGTH) : null
}
