import { html } from 'hono/html'
import { sharePath } from './path'
import type { PublicDeck } from './store'

/** How many decks the top page lists under recently published. */
export const RECENT_DECKS_SHOWN = 10

/** How many decks a profile lists until lists get pages of their own. */
export const PROFILE_DECKS_SHOWN = 100

export const dateFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  dateStyle: 'medium',
})

/** A deck is named by its title, or by its ID before it has one. */
export const deckName = (deck: Pick<PublicDeck, 'slug' | 'title'>) =>
  deck.title ?? deck.slug

const dateTime = (deck: PublicDeck) =>
  html`<time datetime="${new Date(deck.readyAt * 1000).toISOString()}"
    >${dateFormat.format(deck.readyAt * 1000)}</time
  >`

/** A deck on its author's profile, where the author goes without saying. */
const deckCard = (deck: PublicDeck) =>
  html`<li class="card">
    <a class="card-title" href="${sharePath(deck.handle, deck.slug)}"
      >${deckName(deck)}</a
    >
    <p class="card-meta">${dateTime(deck)}</p>
  </li>`

/** An author's profile: their public decks, and a way in for the author. */
export function profileBody(
  handle: string,
  decks: readonly PublicDeck[],
  isOwner: boolean,
) {
  return html`<section class="profile">
      <h1>@${handle}</h1>
      ${
        isOwner
          ? html`<p><a class="cta" href="/decks">デッキを管理する</a></p>`
          : ''
      }
    </section>
    <section>
      <h2>公開中のスライド</h2>
      ${
        decks.length
          ? html`<ul class="cards">
              ${decks.map(deckCard)}
            </ul>`
          : html`<p class="empty">公開中のスライドはまだありません。</p>`
      }
    </section>`
}
