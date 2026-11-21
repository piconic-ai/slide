import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'
import { dayFormats } from './dates'
import { coverUrl } from './cover'
import { deckCard } from '../site/deck-card'
import {
  citationsPath,
  peoplePath,
  profilePath,
  sharePath,
  type CitationList,
} from './path'
import type { Handle } from './handle'
import { profileFollowForm, type FollowState } from '../follows/pages'
import { peopleListBody } from '../follows/people-pages'
import { citationListBody } from '../citations/profile-pages'
import type { PairRow } from '../citations/pair-store'
import type { PeopleReader } from '../follows/people'
import { loginPrompt } from '../site/login-prompt'
import type { Person } from '../follows/store'
import type { PeopleList } from './path'
import type { PublicDeck } from './store'
import {
  profileCard,
  profileTabName,
  profileTabs,
  type ProfileCounts,
} from '../profile/pages'
import { profileStatsFrame } from '../profile/stats-frame'
import type { StoredProfile } from '../profile/store'

/** How many decks the top page lists under recently published. */
export const RECENT_DECKS_SHOWN = 8

/** How many decks a profile lists until lists get pages of their own. */
export const PROFILE_DECKS_SHOWN = 100

/** A deck is named by its title, or by its ID before it has one. */
export const deckName = (deck: Pick<PublicDeck, 'slug' | 'title'>) =>
  deck.title ?? deck.slug

const text = messages({
  ja: {
    none: '公開中のスライドはまだありません。',
  },
  en: {
    none: 'No published slides yet.',
  },
})

const dateTime = (deck: PublicDeck, lang: Lang) =>
  html`<time datetime="${new Date(deck.readyAt * 1000).toISOString()}"
    >${dayFormats[lang].format(deck.readyAt * 1000)}</time
  >`

/** A deck on its author's profile, where the author goes without saying. */
const profileDeck = (deck: PublicDeck, lang: Lang, contentBase: URL | null) =>
  deckCard(
    {
      name: deckName(deck),
      href: sharePath(deck.handle, deck.slug),
      coverUrl:
        contentBase === null
          ? null
          : coverUrl(contentBase, deck.deploymentId, deck.coverPath),
    },
    dateTime(deck, lang),
  )

/** What a profile shows under its tabs: the slides, or one of its lists. */
export type ProfileView =
  | Readonly<{
      kind: 'slides'
      decks: readonly PublicDeck[]
      contentBase: URL | null
    }>
  | Readonly<{
      kind: 'people'
      list: PeopleList
      people: readonly Person[]
      page: number
      /** Who looks at the list, which decides the buttons its rows have. */
      reader: PeopleReader
    }>
  | Readonly<{
      kind: 'citations'
      list: CitationList
      rows: readonly PairRow[]
      page: number
      contentBase: URL | null
    }>

/** The title of a profile's page: the author, after the open list if any. */
export const profileTitle = (handle: Handle, view: ProfileView, lang: Lang) =>
  view.kind === 'slides'
    ? `@${handle}`
    : `${profileTabName(view.list, lang)} - @${handle}`

/** What a profile shows under its tabs: the open part, in its section. */
function openPart(
  handle: Handle,
  counts: ProfileCounts,
  view: ProfileView,
  lang: Lang,
) {
  switch (view.kind) {
    case 'people':
      return html`<section class="people">
        ${peopleListBody({ handle, ...view, total: counts[view.list] }, lang)}
      </section>`
    case 'citations':
      return html`<section class="citations-list">
        ${citationListBody({ handle, ...view, total: counts[view.list] }, lang)}
      </section>`
    case 'slides':
      return html`<section class="published">
        ${
          view.decks.length
            ? html`<ul class="deck-grid">
                ${view.decks.map((deck) =>
                  profileDeck(deck, lang, view.contentBase),
                )}
              </ul>`
            : html`<div class="empty-state">
                <p>${text[lang].none}</p>
              </div>`
        }
      </section>`
  }
}

/** The path of the part of a profile that is open. */
const openPath = (handle: Handle, view: ProfileView) =>
  view.kind === 'people'
    ? peoplePath(handle, view.list)
    : view.kind === 'citations'
      ? citationsPath(handle, view.list)
      : profilePath(handle)

/**
 * An author's profile: who they are, the switch between their
 * slides and the people around them, and the open one of those. The author
 * sees what a reader sees; the way to their own slides is the account menu's.
 */
export function profileBody(
  author: Readonly<{
    handle: Handle
    profile: StoredProfile | null
    counts: ProfileCounts
  }>,
  view: ProfileView,
  reader: FollowState | 'owner',
  lang: Lang,
) {
  const { handle } = author
  const action =
    reader === 'owner' ? '' : profileFollowForm(reader, handle, lang)
  const asksToSignIn =
    reader === 'signed-out' ||
    (view.kind === 'people' && view.reader.kind === 'signed-out')
  return html`${
      asksToSignIn ? loginPrompt('follow', openPath(handle, view), lang) : ''
    }
    <section class="profile">
      ${profileCard(handle, author.profile, lang, action)}
    </section>
    ${profileStatsFrame(handle, author.counts, lang)}
    ${profileTabs(handle, author.counts, view.kind === 'slides' ? 'slides' : view.list, lang)}
    ${openPart(author.handle, author.counts, view, lang)}`
}
