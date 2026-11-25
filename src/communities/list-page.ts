import { html } from 'hono/html'
import { neighbourPages } from '../follows/people'
import { messages, type Lang } from '../site/i18n'
import { NEW_COMMUNITIES_PATH } from '../site/home-shape'
import { communityCard } from './card-markup'
import type { CommunityCard } from './community-card'

const text = messages({
  ja: {
    title: '新着のコミュニティ',
    none: 'コミュニティは、まだありません。',
    pastEnd: 'このページには、コミュニティがありません。',
    pages: '一覧のページ',
    previous: '前の 50 件',
    next: '次の 50 件',
  },
  en: {
    title: 'New communities',
    none: 'No communities yet.',
    pastEnd: 'No communities on this page.',
    pages: 'Pages of the list',
    previous: 'Previous 50',
    next: 'Next 50',
  },
})

export const newCommunitiesTitle = (lang: Lang) => text[lang].title

const pagePath = (page: number) =>
  page === 1 ? NEW_COMMUNITIES_PATH : `${NEW_COMMUNITIES_PATH}?page=${page}`

/**
 * Every community, the newest made first, 50 to a page with the way to the
 * pages around, as a profile's tab of communities pages them (F30-AC47).
 */
export function newCommunitiesBody(
  list: Readonly<{
    cards: readonly CommunityCard[]
    page: number
    /** How many communities the whole list has, over all its pages. */
    total: number
  }>,
  lang: Lang,
) {
  const t = text[lang]
  const { previous, next } = neighbourPages(list.page, list.total)
  const link = (page: number | null, rel: 'prev' | 'next', label: string) =>
    page === null
      ? ''
      : html`<a rel="${rel}" href="${pagePath(page)}">${label}</a>`
  return html`<h1>${t.title}</h1>
    ${
      list.cards.length > 0
        ? html`<ul class="community-grid">
            ${list.cards.map(communityCard)}
          </ul>`
        : html`<p class="empty">${list.total === 0 ? t.none : t.pastEnd}</p>`
    }
    ${
      previous === null && next === null
        ? ''
        : html`<nav class="people-pages" aria-label="${t.pages}">
            ${link(previous, 'prev', t.previous)} ${link(next, 'next', t.next)}
          </nav>`
    }`
}
