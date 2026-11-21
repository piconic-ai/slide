import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'

type Html = HtmlEscapedString | Promise<HtmlEscapedString>

/**
 * A deck's cover in two layers: a face carrying its name, and over it the
 * image. While the image loads, and when it cannot be read, the name shows.
 * /share.js hides an image that fails, so no broken-image mark appears; an
 * inline handler would not run under the pages' policy.
 */
export const deckCover = (name: string, coverUrl: string | null) =>
  html`<span class="deck-cover">
    <span class="deck-cover-name" aria-hidden="true">${name}</span>
    ${
      coverUrl
        ? html`<img
            data-cover
            src="${coverUrl}"
            alt=""
            loading="lazy"
            referrerpolicy="no-referrer"
          />`
        : ''
    }
  </span>`

/**
 * One deck in a list: its cover and name as one link, then a line about it.
 * The top page, profiles, the viewer's citations and a deck's own page all
 * show decks with this card.
 */
export const deckCard = (
  deck: Readonly<{ name: string; href: string; coverUrl: string | null }>,
  meta: Html | string = '',
) =>
  html`<li class="deck-card">
    <a class="card-title" href="${deck.href}">
      ${deckCover(deck.name, deck.coverUrl)}
      <span class="deck-name">${deck.name}</span>
    </a>
    ${meta ? html`<p class="card-meta">${meta}</p>` : ''}
  </li>`
