import { html } from 'hono/html'
import { citedNote } from '../citations/cards'
import { dayFormats } from '../share/dates'
import { deckCard } from '../site/deck-card'
import type { CommunityRecentDeck } from '../site/home-communities'
import { FOLLOWED_COMMUNITY_TALKS_PATH } from '../site/home-shape'
import { messages, type Lang } from '../site/i18n'

/** How many slides one page of the list shows (D-52). */
export const FOLLOWED_TALKS_PER_PAGE = 24

const text = messages({
  ja: {
    title: 'フォローしているコミュニティの新着',
    none: 'フォローしているコミュニティに入ったスライドは、まだありません。',
    pastEnd: 'このページには、スライドがありません。',
    pages: '一覧のページ',
    previous: '前の 24 枚',
    next: '次の 24 枚',
  },
  en: {
    title: 'New from communities you follow',
    none: 'No slides in the communities you follow yet.',
    pastEnd: 'No slides on this page.',
    pages: 'Pages of the list',
    previous: 'Previous 24',
    next: 'Next 24',
  },
})

export const followedTalksTitle = (lang: Lang) => text[lang].title

/**
 * The line under a card of a followed community's slide: the author, the
 * day, how often it is cited, and the community after a mark of its color
 * (F31-AC4), as the top page draws it.
 */
export const communityCardMeta = (deck: CommunityRecentDeck, lang: Lang) =>
  html`<a href="${deck.authorHref}">@${deck.handle}</a> ·
    <time datetime="${deck.publishedAt}"
      >${dayFormats[lang].format(new Date(deck.publishedAt))}</time
    >${citedNote(deck.citedBy, lang)}<span class="card-community"
      ><span
        class="community-mark community-mark-${deck.community.color}"
        aria-hidden="true"
      ></span
      ><a href="${deck.community.href}">${deck.community.name}</a></span
    >`

/**
 * Where the pages before and after this one are, when there are any. A
 * page past the end leads back to the last page that has slides, as a
 * person's lists do (`neighbourPages`, src/follows/people.ts).
 */
export function feedPages(
  page: number,
  total: number,
): Readonly<{ previous: number | null; next: number | null }> {
  const last = Math.max(1, Math.ceil(total / FOLLOWED_TALKS_PER_PAGE))
  return {
    previous: page > 1 ? Math.min(page - 1, last) : null,
    next: page < last ? page + 1 : null,
  }
}

const pagePath = (page: number) =>
  page === 1
    ? FOLLOWED_COMMUNITY_TALKS_PATH
    : `${FOLLOWED_COMMUNITY_TALKS_PATH}?page=${page}`

/**
 * Every slide of the communities the reader follows, in the order of the
 * top page, 24 to a page with the way to the pages around (F31-AC5).
 */
export function followedTalksBody(
  list: Readonly<{
    decks: readonly CommunityRecentDeck[]
    page: number
    /** How many slides the whole list has, over all its pages. */
    total: number
  }>,
  lang: Lang,
) {
  const t = text[lang]
  const link = (page: number, rel: 'prev' | 'next', label: string) =>
    html`<a rel="${rel}" href="${pagePath(page)}">${label}</a>`
  const { previous, next } = feedPages(list.page, list.total)
  const pages = [
    previous === null ? '' : link(previous, 'prev', t.previous),
    next === null ? '' : link(next, 'next', t.next),
  ].filter((part) => part !== '')
  return html`<h1>${t.title}</h1>
    ${
      list.decks.length > 0
        ? html`<ul class="deck-grid deck-grid-4">
            ${list.decks.map((deck) =>
              deckCard(deck, communityCardMeta(deck, lang)),
            )}
          </ul>`
        : html`<p class="empty">${list.page === 1 ? t.none : t.pastEnd}</p>`
    }
    ${
      pages.length > 0
        ? html`<nav class="people-pages" aria-label="${t.pages}">${pages}</nav>`
        : ''
    }`
}
