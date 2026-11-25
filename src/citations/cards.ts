import { html } from 'hono/html'
import { coverUrl } from '../share/cover'
import { dayFormats } from '../share/dates'
import { profilePath, sharePath } from '../share/path'
import { deckCard } from '../site/deck-card'
import type { Lang } from '../site/i18n'
import { citedCountText } from './cited-count'
import { shorten, type Shortened } from './citing'
import { citedKey } from './cited-count'
import type { CitedDeck } from './store'

/** The card's note of how many decks cite it, with its dot; empty for none. */
export const citedNote = (count: number, lang: Lang) => {
  const note = citedCountText(count, lang)
  return note === null ? '' : html` · <span class="card-cited">${note}</span>`
}

/** A deck on one side of a citation, as its card shows it. */
export type CitationCard = Readonly<{
  name: string
  href: string
  handle: string
  authorHref: string
  /** When the version readers see became ready, in seconds. */
  publishedAt: number
  /** The cover image; without one the card shows the name alone. */
  coverUrl: string | null
  /** How many decks cite it, as the reader may see them; 0 shows nothing. */
  citedBy: number
}>

/**
 * What the card of a deck shows, with links already made. Without a content
 * origin there is no cover to load, and the card shows the name alone.
 */
export const toCitationCard = (
  deck: CitedDeck,
  contentBase: URL | null,
  citedBy: ReadonlyMap<string, number> = new Map(),
): CitationCard => ({
  name: deck.title ?? deck.slug,
  href: sharePath(deck.handle, deck.slug),
  handle: deck.handle,
  authorHref: profilePath(deck.handle),
  publishedAt: deck.at,
  coverUrl: contentBase
    ? coverUrl(contentBase, deck.deploymentId, deck.coverPath)
    : null,
  citedBy: citedBy.get(citedKey(deck.handle, deck.slug)) ?? 0,
})

/**
 * The decks on one side of a citation as a grid of cover cards: each links
 * to its viewer, and under it stand its author and the day it was published.
 * No deck runs here. A narrow column, as on a deck's own page, takes three
 * across; the full width of the viewer takes four.
 */
export const citationCardGrid = (
  cards: readonly CitationCard[],
  lang: Lang,
  labelledBy: string,
  /** How many cards stand side by side on a wide screen. */
  across: 3 | 4 = 3,
) =>
  html`<ul
    class="${across === 4 ? 'deck-grid deck-grid-4' : 'deck-grid'}"
    aria-labelledby="${labelledBy}"
  >
    ${cards.map((card) => {
      const at = new Date(card.publishedAt * 1000)
      return deckCard(
        card,
        html`<a href="${card.authorHref}">@${card.handle}</a> ·
          <time datetime="${at.toISOString()}"
            >${dayFormats[lang].format(at)}</time
          >${citedNote(card.citedBy, lang)}`,
      )
    })}
  </ul>`

/**
 * Both sides of a deck's citations as the viewer shows them: the first few
 * cards of each, and how many more there are. The citing side comes already
 * cut, with its count; the cited side comes whole.
 */
export const toViewerCitations = (
  read: Readonly<{
    cites: readonly CitedDeck[]
    citedBy: Readonly<{ decks: readonly CitedDeck[]; total: number }>
  }>,
  contentBase: URL | null,
  /** How many decks cite each, by `handle/slug`; a deck left out has none. */
  counts: ReadonlyMap<string, number> = new Map(),
): Readonly<{
  cites: Shortened<CitationCard>
  citedBy: Shortened<CitationCard>
}> => {
  const card = (deck: CitedDeck) => toCitationCard(deck, contentBase, counts)
  const citedBy = shorten(read.citedBy.decks)
  return {
    cites: shorten(read.cites.map(card)),
    citedBy: {
      shown: citedBy.shown.map(card),
      more: Math.max(0, read.citedBy.total - citedBy.shown.length),
    },
  }
}
