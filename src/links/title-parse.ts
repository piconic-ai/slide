import { decodeHTML } from 'entities'
import { fetchedTitleOf } from './link'

/** How much of a page is read: the title is in the head, near the start. */
export const MAX_PAGE_BYTES = 64 * 1024
// A tag longer than this is not looked into.
const MAX_TAG_LENGTH = 4096
const ATTRIBUTE =
  /([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gu

/** The attributes of one tag, with the names in lower case. */
function attributesOf(tag: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>()
  for (const match of tag.matchAll(ATTRIBUTE)) {
    const name = (match[1] ?? '').toLowerCase()
    if (!found.has(name))
      found.set(name, match[2] ?? match[3] ?? match[4] ?? '')
  }
  return found
}

/** The `content` of the first `og:title` meta tag. Scans once; no backtracking. */
function openGraphTitle(page: string): string | null {
  const lower = page.toLowerCase()
  let at = lower.indexOf('<meta')
  while (at !== -1) {
    const end = lower.indexOf('>', at)
    if (end === -1) return null
    if (end - at <= MAX_TAG_LENGTH) {
      const attributes = attributesOf(page.slice(at + 5, end))
      const kind = (attributes.get('property') ?? attributes.get('name') ?? '')
        .trim()
        .toLowerCase()
      const content = attributes.get('content')
      if (kind === 'og:title' && content !== undefined) return content
    }
    at = lower.indexOf('<meta', end + 1)
  }
  return null
}

/** The text of the first `<title>` element that is closed. */
function titleElement(page: string): string | null {
  const lower = page.toLowerCase()
  const open = lower.indexOf('<title')
  if (open === -1) return null
  const start = lower.indexOf('>', open)
  if (start === -1) return null
  const close = lower.indexOf('</title', start)
  return close === -1 ? null : page.slice(start + 1, close)
}

/**
 * The title of an HTML page: its `og:title`, else its `<title>`, with the
 * character references decoded and made fit to keep (`fetchedTitleOf`), or
 * null. Only the start of `page` is read (`MAX_PAGE_BYTES` characters at
 * most), and a page cut short or broken gives the title it still holds, or
 * null. The page is not trusted: what comes out is text, to be escaped where
 * it is shown.
 */
export function titleOfPage(page: string): string | null {
  const head = page.slice(0, MAX_PAGE_BYTES)
  for (const raw of [openGraphTitle(head), titleElement(head)]) {
    if (raw === null) continue
    const title = fetchedTitleOf(decodeHTML(raw))
    // A page with an empty og:title still has a <title>.
    if (title !== null) return title
  }
  return null
}
