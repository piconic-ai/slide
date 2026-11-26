import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'
import { dayFormats } from './dates'
import { coverUrl } from './cover'
import { citedNote } from '../citations/cards'
import { citedKey } from '../citations/cited-count'
import { deckCard } from '../site/deck-card'
import {
  citationsPath,
  communitiesPath,
  peoplePath,
  profilePath,
  sharePath,
  type CitationList,
} from './path'
import type { Handle } from './handle'
import {
  profileFollowForm,
  refusedFollowForm,
  type FollowState,
} from '../follows/pages'
import { profileBlockMenu, type ProfileBlock } from '../blocks/pages'
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
  type ProfileTab,
} from '../profile/pages'
import {
  communitiesListFrame,
  type CommunitiesList,
} from '../profile/community-frames'
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
const profileDeck = (
  deck: PublicDeck,
  lang: Lang,
  contentBase: URL | null,
  citedBy: number,
) =>
  deckCard(
    {
      name: deckName(deck),
      href: sharePath(deck.handle, deck.slug),
      coverUrl:
        contentBase === null
          ? null
          : coverUrl(contentBase, deck.deploymentId, deck.coverPath),
    },
    html`${dateTime(deck, lang)}${citedNote(citedBy, lang)}`,
  )

/** What a profile shows under its tabs: the slides, or one of its lists. */
export type ProfileView =
  | Readonly<{
      kind: 'slides'
      decks: readonly PublicDeck[]
      contentBase: URL | null
      /** How many decks cite each, by `handle/slug`; a deck left out has none. */
      citedBy: ReadonlyMap<string, number>
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
  /** The communities the author follows (F31-AC8). */
  | (Readonly<{ kind: 'communities' }> &
      Omit<CommunitiesList, 'handle' | 'total'>)

/** The title of a profile's page: the author, after the open list if any. */
export const profileTitle = (handle: Handle, view: ProfileView, lang: Lang) =>
  view.kind === 'slides'
    ? `@${handle}`
    : `${profileTabName(openTab(view), lang)} - @${handle}`

/** The tab of the part of a profile that is open. */
const openTab = (view: ProfileView): ProfileTab => {
  switch (view.kind) {
    case 'slides':
    case 'communities':
      return view.kind
    case 'people':
    case 'citations':
      return view.list
  }
}

/** What a profile shows under its tabs: the open part, in its section. */
function openPart(
  handle: Handle,
  counts: ProfileCounts,
  view: ProfileView,
  lang: Lang,
) {
  switch (view.kind) {
    case 'communities':
      return communitiesListFrame(
        { ...view, handle, total: counts.communities },
        lang,
      )
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
                  profileDeck(
                    deck,
                    lang,
                    view.contentBase,
                    view.citedBy.get(citedKey(deck.handle, deck.slug)) ?? 0,
                  ),
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
const openPath = (handle: Handle, view: ProfileView) => {
  switch (view.kind) {
    case 'people':
      return peoplePath(handle, view.list)
    case 'citations':
      return citationsPath(handle, view.list)
    case 'communities':
      return communitiesPath(handle)
    case 'slides':
      return profilePath(handle)
  }
}

/**
 * Who reads a profile, as far as its buttons go: its author, or a reader
 * who may follow (or not, `refused`: one of the two blocked the other).
 * `block` is what the ⋯ menu offers: nothing to a reader who is not signed
 * in and active, a way to block, or, once the reader blocked the author,
 * that they are blocking and where to undo it.
 */
export type ProfileReader =
  | Readonly<{ kind: 'owner' }>
  | Readonly<{
      kind: 'reader'
      follow: FollowState | 'refused'
      block: ProfileBlock
    }>

/** The buttons right of a profile's head: follow, then the ⋯ menu. */
function profileActions(handle: Handle, reader: ProfileReader, lang: Lang) {
  if (reader.kind === 'owner') return ''
  const follow =
    reader.follow === 'refused'
      ? refusedFollowForm(lang)
      : profileFollowForm(reader.follow, handle, lang)
  const menu =
    reader.block === 'none' ? '' : profileBlockMenu(handle, reader.block, lang)
  if (!follow && !menu) return ''
  return html`<div class="profile-buttons">${follow}${menu}</div>`
}

/**
 * An author's profile: who they are, the switch between their slides and
 * their lists, each tab with its count (the head has no numbers), and the
 * open one of those. The author
 * sees what a reader sees; the way to their own slides is the account menu's.
 */
export function profileBody(
  author: Readonly<{
    handle: Handle
    profile: StoredProfile | null
    counts: ProfileCounts
  }>,
  view: ProfileView,
  reader: ProfileReader,
  lang: Lang,
) {
  const { handle } = author
  const action = profileActions(handle, reader, lang)
  const asksToSignIn =
    (reader.kind === 'reader' && reader.follow === 'signed-out') ||
    (view.kind === 'people' && view.reader.kind === 'signed-out')
  return html`${
      asksToSignIn ? loginPrompt('follow', openPath(handle, view), lang) : ''
    }
    <section class="profile">
      ${profileCard(handle, author.profile, lang, action)}
    </section>
    ${profileTabs(handle, author.counts, openTab(view), lang)}
    ${openPart(author.handle, author.counts, view, lang)}`
}
