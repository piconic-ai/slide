import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'
import { dayFormats } from './dates'
import { sharePath } from './path'
import type { PublicDeck } from './store'

/** How many decks the top page lists under recently published. */
export const RECENT_DECKS_SHOWN = 10

/** How many decks a profile lists until lists get pages of their own. */
export const PROFILE_DECKS_SHOWN = 100

/** A deck is named by its title, or by its ID before it has one. */
export const deckName = (deck: Pick<PublicDeck, 'slug' | 'title'>) =>
  deck.title ?? deck.slug

const text = messages({
  ja: {
    manage: 'デッキを管理する',
    published: '公開中のスライド',
    none: '公開中のスライドはまだありません。',
  },
  en: {
    manage: 'Manage your decks',
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
  html`<li class="card">
    <a class="card-title" href="${sharePath(deck.handle, deck.slug)}"
      >${deckName(deck)}</a
    >
    <p class="card-meta">${dateTime(deck, lang)}</p>
  </li>`

/** An author's profile: their public decks, and a way in for the author. */
export function profileBody(
  handle: string,
  decks: readonly PublicDeck[],
  isOwner: boolean,
  lang: Lang,
) {
  const t = text[lang]
  return html`<section class="profile">
      <h1>@${handle}</h1>
      ${
        isOwner ? html`<p><a class="cta" href="/decks">${t.manage}</a></p>` : ''
      }
    </section>
    <section>
      <h2>${t.published}</h2>
      ${
        decks.length
          ? html`<ul class="cards">
              ${decks.map((deck) => deckCard(deck, lang))}
            </ul>`
          : html`<p class="empty">${t.none}</p>`
      }
    </section>`
}
