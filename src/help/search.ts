import { decodeHTML } from 'entities'
import { LANGS, type Lang } from '../site/i18n'
import type { Catalog, CatalogEntry } from './catalog'
import { helpNumbers, type HelpNumbers } from './numbers'

/** The longest word the search reads, in characters; longer ones are cut. */
export const MAX_QUERY_CHARS = 64

/** How many whitespace-separated words a query is split into at most. */
export const MAX_TERMS = 5

/** How much text an excerpt shows before and after the first match. */
const EXCERPT_BEFORE = 30
const EXCERPT_AFTER = 90

/** Weights: a word in the title outranks one in the lead, which outranks the body. */
const TITLE_WEIGHT = 1000
const LEAD_WEIGHT = 100
const MAX_BODY_WEIGHT = 9

/**
 * Folds text so that it can be compared: width, compatibility forms and case
 * are set aside. Every character is folded on its own and keeps its length,
 * so a position in the folded text is a position in the original, which the
 * excerpt relies on. A character whose folded form is longer is kept as it is.
 */
export function fold(text: string): string {
  let folded = ''
  for (const char of text) {
    const one = char.normalize('NFKC').toLowerCase()
    folded += one.length === char.length ? one : char
  }
  return folded
}

/** Markup as the text a reader reads: tags gone, entities decoded, spaces collapsed. */
export const plainText = (markup: string) =>
  decodeHTML(
    markup
      // Block elements part words; inline ones (code, a) do not.
      .replace(/<\/?(?:p|li|ul|ol|h[1-6]|div|section|br)\b[^>]*>/gu, ' ')
      .replace(/<[^>]*>/gu, ''),
  )
    .replace(/\s+/gu, ' ')
    .trim()

/**
 * Folds what the reader typed. It needs no alignment, so the whole word is
 * folded at once: half-width katakana with a voiced mark, which join into
 * one character only when the word is looked at as a whole, then match.
 */
export const foldQuery = (word: string) => word.normalize('NFKC').toLowerCase()

export type SearchQuery =
  | Readonly<{ kind: 'empty' }>
  /**
   * `shown` is what the search box shows again. `terms` are the words that
   * are looked for; it is empty when the query has no letter or digit, which
   * no article answers.
   */
  | Readonly<{ kind: 'words'; shown: string; terms: readonly string[] }>

const HAS_WORD_CHARACTER = /[\p{L}\p{N}]/u

/**
 * Reads the word the search form sent. Blank is no search at all; the help's
 * entrance answers it. A longer word is cut to `MAX_QUERY_CHARS` characters.
 */
export function parseQuery(raw: string | null | undefined): SearchQuery {
  const words = (raw ?? '').split(/\s+/u).filter((word) => word !== '')
  if (words.length === 0) return { kind: 'empty' }
  const shown = Array.from(words.join(' ')).slice(0, MAX_QUERY_CHARS).join('')
  const terms = [
    ...new Set(
      shown
        .split(' ')
        .filter((word) => HAS_WORD_CHARACTER.test(word))
        .map(foldQuery),
    ),
  ].slice(0, MAX_TERMS)
  return { kind: 'words', shown, terms }
}

type DocText = Readonly<{
  title: string
  foldedTitle: string
  /** The lead, a space, then the body. */
  text: string
  foldedText: string
  /** Where the lead ends in `text`. */
  leadEnd: number
}>

export type SearchEntry = Readonly<{
  entry: CatalogEntry
  docs: Readonly<Record<Lang, DocText>>
}>

/** Both languages of every article, ready to be searched. */
export type SearchIndex = readonly SearchEntry[]

async function docOf(
  entry: CatalogEntry,
  lang: Lang,
  numbers: HelpNumbers,
): Promise<DocText> {
  const text = entry.article[lang]
  const [lead, body] = await Promise.all([
    text.lead(numbers),
    text.body(numbers),
  ])
  const leadText = plainText(String(lead))
  const full = `${leadText} ${plainText(String(body))}`
  return {
    title: text.title,
    foldedTitle: fold(text.title),
    text: full,
    foldedText: fold(full),
    leadEnd: leadText.length,
  }
}

/**
 * Builds the index from the article files: the same text the pages show, in
 * both languages, so that a word is found whichever language the page is in.
 */
export async function buildSearchIndex(
  catalog: Catalog,
  numbers: HelpNumbers = helpNumbers(),
): Promise<SearchIndex> {
  return Promise.all(
    catalog.map(async (entry) => {
      const [ja, en] = await Promise.all(
        LANGS.map((lang) => docOf(entry, lang, numbers)),
      )
      return { entry, docs: { ja, en } as Record<Lang, DocText> }
    }),
  )
}

/** A stretch of an excerpt; `mark` says the word searched for is in it. */
export type Segment = Readonly<{ text: string; mark: boolean }>

export type Excerpt = Readonly<{
  /** The language the excerpt is written in. */
  lang: Lang
  /** The excerpt starts in the middle of the text. */
  cut: Readonly<{ before: boolean; after: boolean }>
  segments: readonly Segment[]
}>

export type SearchHit = Readonly<{
  entry: CatalogEntry
  score: number
  excerpt: Excerpt
}>

type Scored = Readonly<{ lang: Lang; score: number; doc: DocText }>

const countOf = (haystack: string, term: string) => {
  let count = 0
  for (
    let at = haystack.indexOf(term);
    at !== -1 && count < MAX_BODY_WEIGHT;
    at = haystack.indexOf(term, at + term.length)
  )
    count += 1
  return count
}

/** A document's score, or null when a word of the query is not in it. */
function score(doc: DocText, terms: readonly string[]): number | null {
  let total = 0
  for (const term of terms) {
    const inTitle = doc.foldedTitle.includes(term)
    const at = doc.foldedText.indexOf(term)
    if (!inTitle && at === -1) return null
    if (inTitle) total += TITLE_WEIGHT
    if (at !== -1 && at < doc.leadEnd) total += LEAD_WEIGHT
    total += Math.min(MAX_BODY_WEIGHT, countOf(doc.foldedText, term))
  }
  return total
}

const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff
const isWordChar = (char: string | undefined) =>
  char !== undefined && /[A-Za-z0-9]/u.test(char)

/**
 * Where an excerpt starts and ends in the text: a little before the first
 * match and a little after it, never inside a surrogate pair, and never in
 * the middle of an English word at the start.
 */
function excerptWindow(text: string, anchor: number) {
  let start = Math.max(0, anchor - EXCERPT_BEFORE)
  let end = Math.min(text.length, start + EXCERPT_BEFORE + EXCERPT_AFTER)
  if (start > 0 && isLow(text.charCodeAt(start))) start -= 1
  while (
    start > 0 &&
    start < anchor &&
    isWordChar(text[start - 1]) &&
    isWordChar(text[start])
  )
    start += 1
  if (end < text.length && isLow(text.charCodeAt(end))) end -= 1
  return { start, end }
}

/** Which characters of the window are part of a word that was searched for. */
function markedWithin(
  folded: string,
  terms: readonly string[],
  start: number,
  end: number,
): boolean[] {
  const marked = new Array<boolean>(end - start).fill(false)
  for (const term of terms)
    for (
      let at = folded.indexOf(term, start);
      at !== -1 && at < end;
      at = folded.indexOf(term, at + term.length)
    )
      marked.fill(true, at - start, Math.min(end, at + term.length) - start)
  return marked
}

/** Runs of marked and unmarked characters, as the page draws them. */
function segmentsOf(
  text: string,
  start: number,
  marked: readonly boolean[],
): Segment[] {
  const segments: Segment[] = []
  marked.forEach((mark, i) => {
    const char = text[start + i] ?? ''
    const last = segments.at(-1)
    if (last && last.mark === mark)
      segments[segments.length - 1] = { text: last.text + char, mark }
    else segments.push({ text: char, mark })
  })
  return segments
}

/** The excerpt of a document around the first place a word of the query is. */
function excerptOf(
  doc: DocText,
  lang: Lang,
  terms: readonly string[],
): Excerpt {
  const found = terms
    .map((term) => doc.foldedText.indexOf(term))
    .filter((at) => at !== -1)
  const { start, end } = excerptWindow(
    doc.text,
    found.length > 0 ? Math.min(...found) : 0,
  )
  const marked = markedWithin(doc.foldedText, terms, start, end)
  return {
    lang,
    cut: { before: start > 0, after: end < doc.text.length },
    segments: segmentsOf(doc.text, start, marked),
  }
}

/**
 * The articles that hold every word of the query, in either language, best
 * first: a word in the title ranks above one in the lead, and that above one
 * in the body. Articles that score alike keep the help's reading order.
 */
export function searchHelp(
  index: SearchIndex,
  query: SearchQuery,
  lang: Lang,
): readonly SearchHit[] {
  if (query.kind === 'empty' || query.terms.length === 0) return []
  const hits: (SearchHit & { rank: number })[] = []
  index.forEach(({ entry, docs }, rank) => {
    const scored = LANGS.flatMap((docLang): Scored[] => {
      const doc = docs[docLang]
      const value = score(doc, query.terms)
      return value === null ? [] : [{ lang: docLang, score: value, doc }]
    })
    // The page's own language wins a tie.
    const best = scored.reduce<Scored | null>(
      (top, next) =>
        !top ||
        next.score > top.score ||
        (next.score === top.score && next.lang === lang)
          ? next
          : top,
      null,
    )
    if (best)
      hits.push({
        entry,
        score: best.score,
        excerpt: excerptOf(best.doc, best.lang, query.terms),
        rank,
      })
  })
  return hits.toSorted((a, b) => b.score - a.score || a.rank - b.rank)
}
