import { html } from 'hono/html'
import { initialOf, neighbourPages } from '../follows/people'
import { coverUrl } from '../share/cover'
import { dayFormats } from '../share/dates'
import type { Handle } from '../share/handle'
import {
  citationsPath,
  profilePath,
  sharePath,
  type CitationList,
} from '../share/path'
import { deckCover } from '../site/deck-card'
import { messages, type Lang } from '../site/i18n'
import type { PairRow } from './pair-store'

const text = messages({
  ja: {
    none: {
      cited: '引用されたスライドはまだありません。',
      citing: '引用したスライドはまだありません。',
    },
    pastEnd: 'このページには、引用がありません。',
    pages: '一覧のページ',
    previous: '前の 50 件',
    next: '次の 50 件',
    by: (name: string) => `${name}さん`,
    of: 'の',
    quoted: (title: string) => `この人の『${title}』を引用`,
    quoting: (title: string) => `この人の『${title}』が引用`,
  },
  en: {
    none: {
      cited: 'No slides have been cited yet.',
      citing: 'No slides have been cited from here yet.',
    },
    pastEnd: 'Nothing is on this page.',
    pages: 'Pages of the list',
    previous: 'Previous 50',
    next: 'Next 50',
    by: (name: string) => name,
    of: '’s',
    quoted: (title: string) => `Cites this person’s “${title}”`,
    quoting: (title: string) => `Cited by this person’s “${title}”`,
  },
})

/** The mark of a quotation, before the line that says what was cited. */
const quoteMark = html`<svg
  aria-hidden="true"
  width="18"
  height="18"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M10 8H6a2 2 0 0 0-2 2v4h4v-4M20 8h-4a2 2 0 0 0-2 2v4h4v-4" />
</svg>`

/**
 * One pair, seen from the author's side: the deck on the other side, with
 * its cover and author, and under it which deck of this author the pair
 * joins, and the day. The cover and the name are one link to that deck.
 */
const pairRow = (
  row: PairRow,
  list: CitationList,
  contentBase: URL | null,
  lang: Lang,
) => {
  const t = text[lang]
  const name = row.title ?? row.slug
  const href = sharePath(row.handle, row.slug)
  const at = new Date(row.at * 1000)
  const author = row.authorName ?? `@${row.handle}`
  // A deck without a title is named by its slug, as its own card names it.
  const own = row.ownTitle ?? row.ownSlug
  return html`<li class="citation-row">
    <a class="citation-cover" href="${href}" aria-label="${name}"
      >${deckCover(
        name,
        contentBase === null
          ? null
          : coverUrl(contentBase, row.deploymentId, row.coverPath),
      )}</a
    >
    <div class="citation-body">
      <p class="citation-deck">
        <span class="citation-face" aria-hidden="true"
          >${initialOf(author)}</span
        >
        <a class="citation-author" href="${profilePath(row.handle)}"
          ><strong>${t.by(author)}</strong></a
        >${t.of}
        <a class="citation-title" href="${href}">${name}</a>
      </p>
      <p class="citation-line">
        ${quoteMark}
        <span>${list === 'cited' ? t.quoted(own) : t.quoting(own)}</span>
        <span aria-hidden="true">·</span>
        <time datetime="${at.toISOString()}"
          >${dayFormats[lang].format(at)}</time
        >
      </p>
    </div>
  </li>`
}

/**
 * A profile's list of citations, one page of it, with the way to the pages
 * before and after.
 */
export function citationListBody(
  list: Readonly<{
    handle: Handle
    list: CitationList
    rows: readonly PairRow[]
    page: number
    /** How many pairs the whole list shows, over all its pages. */
    total: number
    contentBase: URL | null
  }>,
  lang: Lang,
) {
  const t = text[lang]
  const { previous, next } = neighbourPages(list.page, list.total)
  const link = (page: number | null, rel: 'prev' | 'next', label: string) =>
    page === null
      ? ''
      : html`<a
          rel="${rel}"
          href="${citationsPath(list.handle, list.list, page)}"
          >${label}</a
        >`
  return html`${
    list.rows.length
      ? html`<ul class="citation-list">
          ${list.rows.map((row) =>
            pairRow(row, list.list, list.contentBase, lang),
          )}
        </ul>`
      : html`<p class="people-none">
          ${list.total === 0 ? t.none[list.list] : t.pastEnd}
        </p>`
  }
  ${
    previous === null && next === null
      ? ''
      : html`<nav class="people-pages" aria-label="${t.pages}">
          ${link(previous, 'prev', t.previous)} ${link(next, 'next', t.next)}
        </nav>`
  }`
}
