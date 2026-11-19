import { html } from 'hono/html'
import type { Handle } from '../share/handle'
import { peoplePath, profilePath, type PeopleList } from '../share/path'
import { messages, type Lang } from '../site/i18n'
import { initialOf, neighbourPages } from './people'
import type { Person } from './store'

const text = messages({
  ja: {
    none: {
      following: 'まだだれもフォローしていません。',
      followers: 'フォロワーはまだいません。',
    },
    pastEnd: 'このページには、だれもいません。',
    pages: '一覧のページ',
    previous: '前の 50 人',
    next: '次の 50 人',
  },
  en: {
    none: {
      following: 'Not following anyone yet.',
      followers: 'No followers yet.',
    },
    pastEnd: 'Nobody is on this page.',
    pages: 'Pages of the list',
    previous: 'Previous 50',
    next: 'Next 50',
  },
})

/**
 * A person's picture, or the first letter of their name where they have
 * none. The letter stays under the picture, so it also shows when the
 * picture cannot be read: /share.js hides an image that fails.
 */
const face = (person: Person) =>
  html`<span class="person-face" aria-hidden="true"
    >${initialOf(person.name ?? person.handle)}${
      person.avatarUrl
        ? html`<img
            data-cover
            src="${person.avatarUrl}"
            alt=""
            width="48"
            height="48"
            loading="lazy"
            referrerpolicy="no-referrer"
          />`
        : ''
    }</span
  >`

/** One person: the whole row leads to their profile. */
const personRow = (person: Person) =>
  html`<li>
    ${face(person)}
    <span class="person-names">
      <a class="person-name" href="${profilePath(person.handle)}"
        >${person.name ?? `@${person.handle}`}</a
      >
      ${
        // Without a name the handle already stands as one.
        person.name === null
          ? ''
          : html`<span class="person-handle">@${person.handle}</span>`
      }
    </span>
  </li>`

/**
 * The people an author follows, or their followers, one page of them, with
 * the way to the pages before and after.
 */
export function peopleListBody(
  list: Readonly<{
    handle: Handle
    list: PeopleList
    people: readonly Person[]
    page: number
    /** How many people the whole list shows, over all its pages. */
    total: number
  }>,
  lang: Lang,
) {
  const t = text[lang]
  const { previous, next } = neighbourPages(list.page, list.total)
  const link = (page: number | null, rel: 'prev' | 'next', label: string) =>
    page === null
      ? ''
      : html`<a rel="${rel}" href="${peoplePath(list.handle, list.list, page)}"
          >${label}</a
        >`
  return html`${
    list.people.length
      ? html`<ul class="people-list">
          ${list.people.map(personRow)}
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
