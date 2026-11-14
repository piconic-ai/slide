import { decodeHTML } from 'entities'
import { TAG_BODY } from './title'

/** Descriptions longer than this are cut. */
export const DESCRIPTION_MAX_LENGTH = 300

/**
 * Tokens read in document order, as for the title. Comments and raw-text
 * elements are consumed whole, so a <meta> written inside them is never
 * taken for the document's.
 */
const TOKENS = new RegExp(
  [
    String.raw`<!--[\s\S]*?(?:-->|$)`,
    String.raw`<(script|style|template|textarea|title)(?=[\s/>])${TAG_BODY}>[\s\S]*?(?:<\/\1\s*>|$)`,
    String.raw`<meta(?=[\s/>])(${TAG_BODY})>`,
    String.raw`<\/?[a-z][a-z0-9-]*(?=[\s/>])${TAG_BODY}>`,
  ].join('|'),
  'gi',
)

const ATTRIBUTE =
  /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g

/** A tag's attributes by lowercased name; the first of a name wins. */
function attributesOf(body: string): Map<string, string> {
  const attributes = new Map<string, string>()
  for (const [, name = '', double, single, bare] of body.matchAll(ATTRIBUTE)) {
    const key = name.toLowerCase()
    if (!attributes.has(key))
      attributes.set(key, double ?? single ?? bare ?? '')
  }
  return attributes
}

/**
 * The description an HTML document declares in its first
 * <meta name="description"> with content, with character references decoded
 * and whitespace collapsed, or null when it has none or it is blank. The
 * result is plain text; pages escape it when they render it.
 */
export function descriptionOf(html: string): string | null {
  for (const token of html.matchAll(TOKENS)) {
    if (token[2] === undefined) continue
    const attributes = attributesOf(token[2])
    if (attributes.get('name')?.toLowerCase() !== 'description') continue
    const text = decodeHTML(attributes.get('content') ?? '')
      .replace(/[\s\u0000-\u001f\u007f]+/g, ' ')
      .trim()
    if (!text) continue
    return Array.from(text).slice(0, DESCRIPTION_MAX_LENGTH).join('').trim()
  }
  return null
}
