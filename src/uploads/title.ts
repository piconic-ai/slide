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
 * Tokens read in document order. Comments, raw-text elements and other tags
 * are consumed whole, so a <title> written inside them, or inside an
 * attribute value, is never taken for the document's. Title text is itself
 * plain text, so markup inside it is kept. Unclosed comments, raw text and
 * titles run to the end of the input, so no token is retried from later
 * starts.
 */
const TOKENS = new RegExp(
  [
    String.raw`<!--[\s\S]*?(?:-->|$)`,
    String.raw`<(script|style|template|textarea)(?=[\s/>])${TAG_BODY}>[\s\S]*?(?:<\/\1\s*>|$)`,
    String.raw`<title(?=[\s/>])${TAG_BODY}>([\s\S]*?)(<\/title\s*>|$)`,
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
  for (const token of html.matchAll(TOKENS)) {
    if (token[2] === undefined) continue
    // An unclosed title was cut by the scan limit or never ends.
    if (token[3]) content = token[2]
    break
  }
  if (!content) return null
  const text = decodeHTML(content)
    .replace(/[\s\u0000-\u001f\u007f]+/g, ' ')
    .trim()
  if (!text) return null
  return Array.from(text).slice(0, TITLE_MAX_LENGTH).join('').trim()
}
