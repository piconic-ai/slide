import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import {
  articleHeading,
  SUPPLEMENT_HEADING,
  type ArticleText,
  type LegalText,
  type TransmissionText,
} from './document'
import { LEGAL_TEXTS, type LegalTextKind } from './documents'

/**
 * The Markdown the operator handed over is kept in `handed-over/`. These
 * tests hold the texts the pages draw to it, word for word (F34-AC1,
 * F34-AC2, F34-AC3). The marks of Markdown (`#`, list numbers, table bars)
 * and the layout whitespace are the only differences allowed.
 */
const FILES: Readonly<Record<LegalTextKind, string>> = {
  terms: 'terms.md',
  privacy: 'privacy.md',
  external: 'external-transmission.md',
}

const copy = (kind: LegalTextKind) =>
  readFileSync(new URL(`./handed-over/${FILES[kind]}`, import.meta.url), 'utf8')

/** One line of the handed-over text, with what kind of line it is. */
type Line = { kind: string; text: string }

/** Reads the Markdown the way the operator's documents use it, and no other. */
function outlineOfMarkdown(markdown: string): Line[] {
  const lines: Line[] = []
  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/\s+$/u, '')
    if (line === '') continue
    let match: RegExpExecArray | null
    if ((match = /^# (.+)$/u.exec(line)))
      lines.push({ kind: 'title', text: match[1] })
    else if ((match = /^## (.+)$/u.exec(line)))
      lines.push({ kind: 'heading', text: match[1] })
    else if ((match = /^(\d+)\. (.+)$/u.exec(line)))
      lines.push({ kind: `item1:${match[1]}`, text: match[2] })
    else if ((match = /^ {4}(\d+)\. (.+)$/u.exec(line)))
      lines.push({ kind: `item2:${match[1]}`, text: match[2] })
    else if ((match = /^- (.+)$/u.exec(line)))
      lines.push({ kind: 'history', text: match[1] })
    else if (/^\|[\s|-]+\|$/u.test(line)) continue
    else if ((match = /^\| (.+) \|$/u.exec(line)))
      lines.push({ kind: 'row', text: tableCells(match[1]).join(' | ') })
    else if (/^\s|^[-\d#|]/u.test(line))
      throw new Error(`A line the test does not read: ${line}`)
    else lines.push({ kind: 'paragraph', text: line })
  }
  return lines
}

/** The cells of a table row; a link `[label](url)` reads as `label (url)`. */
const tableCells = (row: string): string[] =>
  row
    .split(' | ')
    .map((cell) =>
      cell.replace(
        /^\[(.+)\]\((.+)\)$/u,
        (_all, label, url) => `${label} (${url})`,
      ),
    )

const articleLines = (text: ArticleText): Line[] => [
  { kind: 'title', text: text.title },
  ...text.preamble.map((text) => ({ kind: 'paragraph', text })),
  ...text.articles.flatMap((article) => [
    { kind: 'heading', text: articleHeading(article) },
    ...(article.body.kind === 'clauses'
      ? article.body.clauses.flatMap((clause, i) => [
          { kind: `item1:${i + 1}`, text: clause.text },
          ...clause.items.map((text, j) => ({ kind: `item2:${j + 1}`, text })),
        ])
      : [
          ...article.body.paragraphs.map((text) => ({
            kind: 'paragraph',
            text,
          })),
          ...article.body.items.map((text, i) => ({
            kind: `item1:${i + 1}`,
            text,
          })),
        ]),
  ]),
]

const transmissionLines = (text: TransmissionText): Line[] => [
  { kind: 'title', text: text.title },
  { kind: 'paragraph', text: text.description },
  { kind: 'row', text: text.columns.join(' | ') },
  ...text.rows.map((row) => ({
    kind: 'row',
    text: [
      row.destination,
      row.information,
      row.purpose,
      `${row.policy.label} (${row.policy.url})`,
    ].join(' | '),
  })),
]

const historyLines = (text: LegalText): Line[] => [
  { kind: 'heading', text: SUPPLEMENT_HEADING },
  ...text.history.map((entry) => ({
    kind: 'history',
    text: `${entry.date}: ${entry.summary}`,
  })),
]

/**
 * The text as the pages hold it, in the lines of the Markdown. The handed-over
 * "External transmission" has no supplement; the page draws one anyway
 * (F34-AC6), so its history is compared only if the Markdown has one.
 */
const linesOfText = (text: LegalText, markdown: string): Line[] => {
  if (text.form === 'articles')
    return [...articleLines(text), ...historyLines(text)]
  return markdown.includes(`\n## ${SUPPLEMENT_HEADING}`)
    ? [...transmissionLines(text), ...historyLines(text)]
    : transmissionLines(text)
}

test.each(['terms', 'privacy'] as const)(
  'F34-AC1, F34-AC2: Given the handed-over %s, When it is compared with the text the page draws, Then every title, sentence, clause number, item number and history line is the same',
  (kind) => {
    expect(linesOfText(LEGAL_TEXTS[kind], copy(kind))).toEqual(
      outlineOfMarkdown(copy(kind)),
    )
  },
)

test('F34-AC3: Given the handed-over page "External transmission", When it is compared with the text the page draws, Then the lead sentence and every cell of the table are the same', () => {
  expect(linesOfText(LEGAL_TEXTS.external, copy('external'))).toEqual(
    outlineOfMarkdown(copy('external')),
  )
})

test.each(['terms', 'privacy', 'external'] as const)(
  'Given the handed-over %s, When its characters are compared with the page text without marks and spaces, Then none was added, dropped or changed',
  (kind) => {
    const flat = (value: string) => value.replace(/\s+/gu, '')
    const fromMarkdown = outlineOfMarkdown(copy(kind))
      .map((line) => line.text)
      .join('')
    const drawn = linesOfText(LEGAL_TEXTS[kind], copy(kind))
      .map((line) => line.text)
      .join('')
    // Table bars and the `label (url)` form are written out the same way.
    expect(flat(drawn)).toBe(flat(fromMarkdown))
  },
)
