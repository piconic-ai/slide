import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'
import { dayFormats } from './dates'
import { coverUrl } from './cover'
import { deckCard } from '../site/deck-card'
import { sharePath } from './path'
import type { Handle } from './handle'
import { profileFollowForm, type FollowState } from '../follows/pages'
import { peopleListBody } from '../follows/people-pages'
import type { Person } from '../follows/store'
import type { PeopleList } from './path'
import type { PublicDeck } from './store'
import {
  profileCard,
  profileTabName,
  profileTabs,
  type ProfileCounts,
} from '../profile/pages'
import type { SyncedProfile } from '../profile/store'

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

/** What a profile shows under its tabs: the slides, or a list of people. */
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
      /** The reader who may follow and unfollow, or null when nobody may. */
      reader: string | null
    }>

/** The title of a profile's page: the author, after the open list if any. */
export const profileTitle = (handle: Handle, view: ProfileView, lang: Lang) =>
  view.kind === 'slides'
    ? `@${handle}`
    : `${profileTabName(view.list, lang)} - @${handle}`

/**
 * An author's profile: who they are on GitHub, the switch between their
 * slides and the people around them, and the open one of those. The author
 * sees what a reader sees; the way to their own slides is the account menu's.
 */
export function profileBody(
  author: Readonly<{
    handle: Handle
    profile: SyncedProfile | null
    counts: ProfileCounts
  }>,
  view: ProfileView,
  reader: FollowState | 'owner',
  lang: Lang,
) {
  const t = text[lang]
  const { handle } = author
  const action =
    reader === 'owner' ? '' : profileFollowForm(reader, handle, lang)
  return html`<section class="profile">
      ${profileCard(handle, author.profile, lang, action)}
    </section>
    ${profileTabs(handle, author.counts, view.kind === 'slides' ? 'slides' : view.list, lang)}
    ${
      view.kind === 'people'
        ? html`<section class="people">
            ${peopleListBody(
              { handle, ...view, total: author.counts[view.list] },
              lang,
            )}
          </section>`
        : html`<section class="published">
            ${
              view.decks.length
                ? html`<ul class="deck-grid">
                    ${view.decks.map((deck) =>
                      profileDeck(deck, lang, view.contentBase),
                    )}
                  </ul>`
                : html`<div class="empty-state">
                    <p>${t.none}</p>
                  </div>`
            }
          </section>`
    }`
}
