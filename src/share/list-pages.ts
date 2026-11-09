import { html } from 'hono/html'
import { homeFeatures, homeHero, homeOutro, homeStyle } from './home'
import { profilePath, sharePath } from './path'
import type { PublicDeck } from './store'

/** How many decks the top page shows under recently published. */
export const RECENT_DECKS_SHOWN = 10

/** How many decks a profile lists until lists get pages of their own. */
export const PROFILE_DECKS_SHOWN = 100

const dateFormat = new Intl.DateTimeFormat('ja-JP', {
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

/** A recent deck as a cover in the top page carousel. */
const recentItem = (deck: PublicDeck) =>
  html`<li>
    <div class="recent-cover">
      <a class="card-title" href="${sharePath(deck.handle, deck.slug)}"
        >${deckName(deck)}</a
      >
    </div>
    <p class="card-meta">
      <a href="${profilePath(deck.handle)}">@${deck.handle}</a> ·
      ${dateTime(deck)}
    </p>
  </li>`

const recentDecks = (decks: readonly PublicDeck[]) =>
  html`<section class="features">
    <h2 id="recent">最近公開されたスライド</h2>
    ${
      decks.length
        ? html`<ul class="recent-list" aria-labelledby="recent">
            ${decks.map(recentItem)}
          </ul>`
        : html`<p class="empty">まだ公開されたスライドはありません。</p>`
    }
  </section>`

/** The top page: the product, recent public decks, where each part stands. */
export function homeBody(recent: readonly PublicDeck[]) {
  return html`${homeStyle} ${homeHero} ${recentDecks(recent)} ${homeFeatures}
  ${homeOutro}`
}

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
