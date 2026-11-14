import { decodeHTMLAttribute } from 'entities'
import {
  COMMENT,
  OPAQUE_ELEMENTS,
  plainText,
  TAG_BODY,
  TEMPLATE_TAG,
  templateDepth,
} from './title'

/** Descriptions longer than this are cut. */
export const DESCRIPTION_MAX_LENGTH = 300

/**
 * Tokens read in document order, as for the title. Comments, the title and
 * elements whose content is not the document's markup are consumed whole,
 * and templates are followed by depth, so a <meta> written inside them is
 * never taken for the document's.
 */
const TOKENS = new RegExp(
  [
    COMMENT,
    String.raw`<(${OPAQUE_ELEMENTS}|title)(?=[\s/>])${TAG_BODY}>[\s\S]*?(?:<\/\1\s*>|$)`,
    TEMPLATE_TAG,
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
  let depth = 0
  for (const token of html.matchAll(TOKENS)) {
    if (token[2] !== undefined) depth = templateDepth(depth, token[2])
    if (token[3] === undefined || depth > 0) continue
    const attributes = attributesOf(token[3])
    if (attributes.get('name')?.toLowerCase() !== 'description') continue
    // An attribute value keeps `&copy=` as written, where text would not.
    const text = plainText(
      decodeHTMLAttribute(attributes.get('content') ?? ''),
      DESCRIPTION_MAX_LENGTH,
    )
    if (text) return text
  }
  return null
}
