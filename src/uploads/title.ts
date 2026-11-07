/** Titles longer than this are cut, so one deck cannot stretch a list. */
export const TITLE_MAX_LENGTH = 200

/** How much of index.html is read for its title; <title> sits in <head>. */
export const TITLE_SCAN_BYTES = 64 * 1024

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  middot: '·',
  bull: '•',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  times: '×',
  yen: '¥',
}

/**
 * Tokens read in document order: a comment or raw-text element, whose text
 * may contain a <title> that is not the document's, or a title element.
 * Title text is itself plain text, so markup inside it is kept.
 */
const TOKENS =
  /<!--[\s\S]*?(?:-->|$)|<(script|style|template|textarea)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)|<title(?=[\s/>])[^>]*>([\s\S]*?)<\/title\s*>/gi

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,
    (match, name: string) => {
      if (name[0] !== '#') return NAMED_ENTITIES[name.toLowerCase()] ?? match
      const code =
        name[1] === 'x' || name[1] === 'X'
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    },
  )
}

/**
 * The title an HTML document declares in its first <title>, with entities
 * decoded and whitespace collapsed, or null when it has none or it is
 * blank. The result is plain text; pages escape it when they render it.
 */
export function titleOf(html: string): string | null {
  const match = Array.from(html.matchAll(TOKENS)).find(
    (token) => token[2] !== undefined,
  )
  if (!match?.[2]) return null
  const text = decodeEntities(match[2])
    .replace(/[\s\u0000-\u001f\u007f]+/g, ' ')
    .trim()
  if (!text) return null
  return Array.from(text).slice(0, TITLE_MAX_LENGTH).join('').trim()
}
