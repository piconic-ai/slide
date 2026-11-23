import { decodeHTML } from 'entities'
import { fetchedTitleOf } from './link'

/** How much of a page is read: the title is in the head, near the start. */
export const MAX_PAGE_BYTES = 64 * 1024
// A tag longer than this is not looked into, and the scan goes on after it.
const MAX_TAG_LENGTH = 4096
// How far into a page a `<meta charset>` is looked for.
export const CHARSET_SNIFF_BYTES = 1024

const isSpace = (ch: string) =>
  ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f'
const isNameChar = (ch: string) => /[A-Za-z0-9:-]/u.test(ch)

type Tag = Readonly<{
  /** Lower-case ASCII name. */
  name: string
  attributes: ReadonlyMap<string, string>
  /** The index of the `>` that closes the tag. */
  end: number
}>

/** What one scan found, and how much work it took (for the tests' bound). */
export type PageScan = Readonly<{
  openGraphTitle: string | null
  title: string | null
  charset: string | null
  /** Characters and tags looked at: at most a small multiple of the page. */
  steps: number
}>

type Counter = () => void
const at_ = (page: string, index: number) => page[index] ?? ''

/** Moves `at` on while `keep` holds for the character there, counting each. */
function skipWhile(
  page: string,
  from: number,
  limit: number,
  keep: (ch: string) => boolean,
  count: Counter,
): number {
  let at = from
  while (at < limit && keep(at_(page, at))) {
    count()
    at++
  }
  return at
}

/** A quoted value is found by `indexOf`; its length still counts as work. */
function countLength(count: Counter, length: number) {
  for (let n = 0; n < length; n += 64) count()
}

/**
 * The value after an `=`, quoted or not, and where it ends. An unclosed
 * quote swallows the rest of the tag's room.
 */
function readValue(
  page: string,
  from: number,
  limit: number,
  count: Counter,
): { value: string; at: number } {
  const quote = at_(page, from)
  if (quote !== '"' && quote !== "'") {
    const end = skipWhile(
      page,
      from,
      limit,
      (ch) => !isSpace(ch) && ch !== '>',
      count,
    )
    return { value: page.slice(from, end), at: end }
  }
  const close = page.indexOf(quote, from + 1)
  const stop = close === -1 || close >= limit ? limit : close
  count()
  countLength(count, stop - from)
  return { value: page.slice(from + 1, stop), at: stop + 1 }
}

/** One attribute (its name in lower case, its value) and where it ends. */
function readAttribute(
  page: string,
  from: number,
  limit: number,
  count: Counter,
): { name: string; value: string; at: number } {
  let at = skipWhile(
    page,
    from,
    limit,
    (ch) => !isSpace(ch) && !'=>/'.includes(ch),
    count,
  )
  // A stray `=` is stepped over.
  if (at === from) at++
  const name = page.slice(from, at).toLowerCase()
  at = skipWhile(page, at, limit, isSpace, count)
  if (page[at] !== '=') return { name, value: '', at }
  at = skipWhile(page, at + 1, limit, isSpace, count)
  const read = readValue(page, at, limit, count)
  return { name, value: read.value, at: read.at }
}

/**
 * Reads the tag that starts at `start` (a `<`) in one pass. Quotes are
 * recognised, so a `>` inside a quoted value does not end the tag. A tag
 * that is not closed within `MAX_TAG_LENGTH` is given up, and the scan goes
 * on after the part that was looked at, so no character is looked at twice.
 * Returns the tag (or null) and where the scan goes on.
 */
function readTag(
  page: string,
  start: number,
  count: Counter,
): { tag: Tag | null; next: number } {
  const limit = Math.min(page.length, start + MAX_TAG_LENGTH)
  let at = skipWhile(page, start + 1, limit, isNameChar, count)
  if (at === start + 1) return { tag: null, next: start + 1 }
  const name = page.slice(start + 1, at).toLowerCase()
  const attributes = new Map<string, string>()
  while (at < limit) {
    count()
    const ch = at_(page, at)
    if (ch === '>') return { tag: { name, attributes, end: at }, next: at + 1 }
    if (isSpace(ch) || ch === '/') {
      at++
      continue
    }
    const read = readAttribute(page, at, limit, count)
    if (read.name !== '' && !attributes.has(read.name))
      attributes.set(read.name, read.value)
    at = read.at
  }
  return { tag: null, next: limit }
}

/** The charset a `<meta>` names, by `charset` or by `http-equiv`. */
function charsetOfMeta(attributes: ReadonlyMap<string, string>): string | null {
  const direct = attributes.get('charset')
  if (direct !== undefined && direct.trim() !== '') return direct.trim()
  if (attributes.get('http-equiv')?.toLowerCase() === 'content-type')
    return charsetOfContentType(attributes.get('content') ?? '')
  return null
}

/** The `charset` of a Content-Type value, or null. */
export function charsetOfContentType(value: string): string | null {
  const match = /charset\s*=\s*"?([^\s;"']+)/iu.exec(value)
  return match?.[1] ?? null
}

const CLOSERS = {
  script: /<\/script[\s/>]/giu,
  style: /<\/style[\s/>]/giu,
  title: /<\/title[\s/>]/giu,
}
type Closed = keyof typeof CLOSERS

/** Where the closing tag of `name` is at or after `from`, or -1. */
function closerOf(name: Closed, page: string, from: number): number {
  const closer = CLOSERS[name]
  closer.lastIndex = from
  return closer.exec(page)?.index ?? -1
}

type Found = {
  openGraphTitle: string | null
  title: string | null
  charset: string | null
}

/** What a `<meta>` says: an `og:title`, a charset. */
function noteMeta(found: Found, attributes: ReadonlyMap<string, string>) {
  const kind = (attributes.get('property') ?? attributes.get('name') ?? '')
    .trim()
    .toLowerCase()
  const content = attributes.get('content')
  if (
    found.openGraphTitle === null &&
    kind === 'og:title' &&
    content !== undefined
  )
    found.openGraphTitle = content
  found.charset ??= charsetOfMeta(attributes)
}

/** Where the scan goes on after a tag, or -1 to stop: raw text is skipped, a title is taken. */
function afterTag(page: string, tag: Tag, at: number, found: Found): number {
  if (tag.name === 'script' || tag.name === 'style')
    return closerOf(tag.name, page, at)
  if (tag.name === 'meta') noteMeta(found, tag.attributes)
  if (tag.name === 'title' && found.title === null) {
    const close = closerOf('title', page, at)
    if (close !== -1) found.title = page.slice(at, close)
    return close
  }
  return at
}

/** Where the scan goes on after the `<` at `lt`, or -1 to stop. */
function scanFrom(
  page: string,
  lt: number,
  found: Found,
  count: Counter,
): number {
  if (page.startsWith('<!--', lt)) {
    const close = page.indexOf('-->', lt + 4)
    return close === -1 ? -1 : close + 3
  }
  const { tag, next } = readTag(page, lt, count)
  return tag ? afterTag(page, tag, next, found) : next
}

/**
 * Looks through the start of a page once, from left to right, and finds the
 * `og:title`, the first `<title>` element, and the charset a `<meta>` names.
 * Names are matched without regard to case on the page itself (never on a
 * lower-cased copy, whose indexes can move). Comments, `<script>` and
 * `<style>` are skipped. Nothing is parsed twice, so the time is in
 * proportion to the length, and a page cut short or broken gives what it
 * still holds.
 */
export function scanPage(page: string): PageScan {
  let steps = 0
  const count = () => {
    steps++
  }
  const found: Found = { openGraphTitle: null, title: null, charset: null }
  let at = 0
  while (at !== -1 && at < page.length) {
    count()
    const lt = page.indexOf('<', at)
    if (lt === -1) break
    at = scanFrom(page, lt, found, count)
    if (found.openGraphTitle !== null && found.title !== null) break
  }
  return { ...found, steps }
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
  const found = scanPage(page.slice(0, MAX_PAGE_BYTES))
  for (const raw of [found.openGraphTitle, found.title]) {
    if (raw === null) continue
    const title = fetchedTitleOf(decodeHTML(raw))
    // A page with an empty og:title still has a <title>.
    if (title !== null) return title
  }
  return null
}

/**
 * The charset a page is read in: the one its Content-Type names, else a
 * `<meta>` in the first bytes (`headAsLatin1`, those bytes written one
 * character each). Null when none is named.
 */
export function charsetOfPage(
  contentType: string,
  headAsLatin1: string,
): string | null {
  return (
    charsetOfContentType(contentType) ??
    scanPage(headAsLatin1.slice(0, CHARSET_SNIFF_BYTES)).charset
  )
}
