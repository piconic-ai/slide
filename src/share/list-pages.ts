import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'
import { dayFormats } from './dates'
import { sharePath } from './path'
import type { Handle } from './handle'
import { profileFollowForm, type FollowState } from '../follows/pages'
import type { PublicDeck } from './store'
import { profileCard } from '../profile/pages'
import type { SyncedProfile } from '../profile/store'

/** How many decks the top page lists under recently published. */
export const RECENT_DECKS_SHOWN = 10

/** How many decks a profile lists until lists get pages of their own. */
export const PROFILE_DECKS_SHOWN = 100

/** A deck is named by its title, or by its ID before it has one. */
export const deckName = (deck: Pick<PublicDeck, 'slug' | 'title'>) =>
  deck.title ?? deck.slug

const text = messages({
  ja: {
    manage: 'スライドを管理する',
    published: '公開中のスライド',
    none: '公開中のスライドはまだありません。',
  },
  en: {
    manage: 'Manage your slides',
    published: 'Published slides',
    none: 'No published slides yet.',
  },
})

const dateTime = (deck: PublicDeck, lang: Lang) =>
  html`<time datetime="${new Date(deck.readyAt * 1000).toISOString()}"
    >${dayFormats[lang].format(deck.readyAt * 1000)}</time
  >`

/** A deck on its author's profile, where the author goes without saying. */
const deckCard = (deck: PublicDeck, lang: Lang) =>
  html`<li class="deck-card">
    <a class="card-title" href="${sharePath(deck.handle, deck.slug)}">
      <span class="deck-cover" aria-hidden="true"></span>${deckName(deck)}
    </a>
    <p class="card-meta">${dateTime(deck, lang)}</p>
  </li>`

/**
 * An author's profile: who they are on GitHub, their public decks, and a way
 * in for the author.
 */
export function profileBody(
  handle: Handle,
  profile: SyncedProfile | null,
  decks: readonly PublicDeck[],
  reader: FollowState | 'owner',
  lang: Lang,
) {
  const t = text[lang]
  const action =
    reader === 'owner' ? '' : profileFollowForm(reader, handle, lang)
  const manage =
    reader === 'owner'
      ? html`<p><a class="cta" href="/slides">${t.manage}</a></p>`
      : ''
  return html`<section class="profile">
      ${profileCard(handle, profile, lang, action, 'block')}
      ${decks.length ? manage : ''}
    </section>
    <section class="published">
      <h2>${t.published}</h2>
      ${
        decks.length
          ? html`<ul class="deck-grid">
              ${decks.map((deck) => deckCard(deck, lang))}
            </ul>`
          : html`<div class="empty-state">
              <p>${t.none}</p>
              ${manage}
            </div>`
      }
    </section>`
}
