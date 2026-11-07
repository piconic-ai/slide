import { html } from 'hono/html'
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

function deckCard(deck: PublicDeck, showAuthor: boolean) {
  return html`<li class="card">
    <a class="card-title" href="${sharePath(deck.handle, deck.slug)}"
      >${deckName(deck)}</a
    >
    <p class="card-meta">
      ${
        showAuthor
          ? html`<a href="${profilePath(deck.handle)}">@${deck.handle}</a> · `
          : ''
      }<time datetime="${new Date(deck.readyAt * 1000).toISOString()}"
        >${dateFormat.format(deck.readyAt * 1000)}</time
      >
    </p>
  </li>`
}

const deckList = (
  decks: readonly PublicDeck[],
  showAuthor: boolean,
  empty: string,
) =>
  decks.length
    ? html`<ul class="cards">
        ${decks.map((deck) => deckCard(deck, showAuthor))}
      </ul>`
    : html`<p class="empty">${empty}</p>`

/** The top page: what the service does, recent public decks, how to start. */
export function homeBody(recent: readonly PublicDeck[]) {
  return html`<section class="hero">
      <h1>HTML のスライドを、<wbr />URL ひとつで届ける。</h1>
      <p>
        GitHub のリポジトリから CI
        でスライドを送り、下書きを確かめてから公開します。参加者は共有された URL
        から、いつでも読み返せます。
      </p>
      <p><a class="cta" href="/decks">GitHub ではじめる</a></p>
    </section>
    <section>
      <h2>最近公開されたスライド</h2>
      ${deckList(recent, true, 'まだ公開されたスライドはありません。')}
    </section>`
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
      ${deckList(decks, false, '公開中のスライドはまだありません。')}
    </section>`
}
