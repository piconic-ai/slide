/**
 * The shapes of the legal texts and the pure decisions made from them. The
 * pages only draw what is here (D-20): a text is a list of articles, each a
 * list of clauses (項) with their items (号), kept as the operator wrote them.
 */

/** A clause (項): a sentence and the items (号) that follow it, if any. */
export interface Clause {
  readonly text: string
  readonly items: readonly string[]
}

/**
 * What an article holds. Numbered clauses and a sentence followed by items
 * are different shapes, so a text cannot be both at once.
 */
export type ArticleBody =
  | { readonly kind: 'clauses'; readonly clauses: readonly Clause[] }
  | {
      readonly kind: 'plain'
      readonly paragraphs: readonly string[]
      readonly items: readonly string[]
    }

export interface Article {
  readonly number: number
  readonly title: string
  readonly body: ArticleBody
}

/**
 * A phrase in the text that is a link to a page of the service. Only the
 * phrases listed here become links; nothing else in the text is linked.
 */
export interface TextLink {
  readonly phrase: string
  readonly href: string
}

/** One line of the supplementary provisions (附則), the history of changes. */
export interface HistoryEntry {
  /** The date as written. A marker such as `(施行日)` while it is not decided. */
  readonly date: string
  readonly summary: string
}

/** The terms and the privacy policy. */
export interface ArticleText {
  readonly form: 'articles'
  readonly title: string
  readonly preamble: readonly string[]
  readonly articles: readonly Article[]
  readonly links: readonly TextLink[]
  readonly history: readonly HistoryEntry[]
}

export interface TransmissionRow {
  readonly destination: string
  readonly information: string
  readonly purpose: string
  readonly policy: { readonly label: string; readonly url: string }
}

/** The page "External transmission": a lead sentence and a table. */
export interface TransmissionText {
  readonly form: 'transmission'
  readonly title: string
  readonly description: string
  /** Column headings: destination, information, purpose, the policy. */
  readonly columns: readonly [string, string, string, string]
  readonly rows: readonly TransmissionRow[]
  readonly history: readonly HistoryEntry[]
}

export type LegalText = ArticleText | TransmissionText

/** The heading of the supplementary provisions, at the end of every text. */
export const SUPPLEMENT_HEADING = '附則'

/** The `id` of the supplementary provisions' heading. */
export const SUPPLEMENT_ID = 'supplement'

/** The heading of an article, as the text writes it: 第 6 条(外部への送信). */
export const articleHeading = (article: Article): string =>
  `第 ${article.number} 条(${article.title})`

/** The `id` of an article's heading, so a URL with `#` reaches it. */
export const articleId = (article: Article): string =>
  `article-${article.number}`

/**
 * Words that stand for values the operator has not decided, written in
 * brackets: `(日数)`. A text that has a date but still carries one is not
 * finished (D-22). Add a word here when the text gets a new kind of blank.
 * Full-width brackets and spaces inside the brackets are read the same.
 */
export const PLACEHOLDER_WORDS = ['日数', '年数', '施行日'] as const

const markOf = (word: string) => new RegExp(`[(（]\\s*${word}\\s*[)）]`, 'u')

/** A date as the operator writes it: 2026-12-01 or 2026年12月1日. */
const DATE_FORMS = [
  /^(\d{4})-(\d{2})-(\d{2})$/u,
  /^(\d{4})年(\d{1,2})月(\d{1,2})日$/u,
] as const

/** True when the value is a real calendar date in one of the two forms. */
export function isEffectiveDate(value: string): boolean {
  const text = value.trim()
  for (const form of DATE_FORMS) {
    const match = form.exec(text)
    if (!match) continue
    const [year, month, day] = match.slice(1).map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    )
  }
  return false
}

/**
 * Whether the text is still a draft: the date of its first line of history
 * (the enactment) is not a date yet. A missing history is a draft too.
 */
export const isDraft = (text: LegalText): boolean => {
  const first = text.history[0]
  return first === undefined || !isEffectiveDate(first.date)
}

const articleStrings = (article: Article): string[] => [
  articleHeading(article),
  ...(article.body.kind === 'clauses'
    ? article.body.clauses.flatMap((clause) => [clause.text, ...clause.items])
    : [...article.body.paragraphs, ...article.body.items]),
]

/** The sentences of the text itself, in reading order: not the history. */
export function bodyStrings(text: LegalText): string[] {
  if (text.form === 'transmission')
    return [
      text.title,
      text.description,
      ...text.columns,
      ...text.rows.flatMap((row) => [
        row.destination,
        row.information,
        row.purpose,
        row.policy.label,
        row.policy.url,
      ]),
    ]
  return [
    text.title,
    ...text.preamble,
    ...text.articles.flatMap(articleStrings),
  ]
}

/** The lines of the history, as drawn: `(施行日): 制定`. */
export const historyStrings = (text: LegalText): string[] =>
  text.history.map((entry) => `${entry.date}: ${entry.summary}`)

/** Every sentence of the page, in reading order, the history included. */
export const textStrings = (text: LegalText): string[] => [
  ...bodyStrings(text),
  SUPPLEMENT_HEADING,
  ...historyStrings(text),
]

/** The marks of undecided values that are still in the text, once each. */
export function leftoverMarks(text: LegalText): string[] {
  const all = textStrings(text).join('\n')
  return PLACEHOLDER_WORDS.filter((word) => markOf(word).test(all)).map(
    (word) => `(${word})`,
  )
}

/**
 * Why a text may not be published as final: it has a date, and still has
 * a blank. Empty when the text is a draft (it is shown as one) or finished.
 */
export const unfinishedReasons = (text: LegalText): string[] =>
  isDraft(text)
    ? []
    : leftoverMarks(text).map((mark) => `${mark} is still in the text`)

export type Segment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string }

/**
 * Cuts a sentence into plain text and the links it holds. A phrase is
 * linked at its first place only; a phrase that is not in the sentence adds
 * no link; joining the segments gives back the sentence.
 */
export function splitLinks(
  sentence: string,
  links: readonly TextLink[],
): Segment[] {
  const found = links
    .map((link) => ({ link, at: sentence.indexOf(link.phrase) }))
    .filter(({ link, at }) => link.phrase !== '' && at >= 0)
    .sort((a, b) => a.at - b.at)
  const segments: Segment[] = []
  let cursor = 0
  for (const { link, at } of found) {
    // A link inside the previous one would cut the sentence twice.
    if (at < cursor) continue
    if (at > cursor)
      segments.push({ kind: 'text', text: sentence.slice(cursor, at) })
    segments.push({ kind: 'link', text: link.phrase, href: link.href })
    cursor = at + link.phrase.length
  }
  if (cursor < sentence.length)
    segments.push({ kind: 'text', text: sentence.slice(cursor) })
  return segments
}
