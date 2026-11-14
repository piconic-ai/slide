import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { deckIdSchema } from '../decks/binding'
import { handleSchema } from '../share/handle'
import { sharePath } from '../share/path'
import { messages, type Lang } from '../site/i18n'
import type { Shortened } from './citing'

type Markup = HtmlEscapedString | Promise<HtmlEscapedString> | string

/** What the viewer shows around a deck. */
export type ReactionsView = Readonly<{
  /** The latest public decks that link to this deck. */
  citedBy: Shortened<CitedView>
  /** The latest public decks this deck links to. */
  cites: Shortened<CitedView>
}>

/** A deck on the other side of a citation, and where it is served from. */
export type CitedView = Readonly<{
  handle: string
  slug: string
  title: string | null
  contentUrl: string
}>

const text = messages({
  ja: {
    citedBy: 'このスライドを引用しているスライド',
    more: (count: number) => `ほか ${count} 件`,
    cites: 'このスライドが引用しているスライド',
  },
  en: {
    citedBy: 'Slides citing these slides',
    more: (count: number) => `${count} more`,
    cites: 'Slides these slides cite',
  },
})

/** Stored names are checked again before they become a link. */
function deckHref(link: Readonly<{ handle: string; slug: string }>) {
  const handle = handleSchema.safeParse(link.handle)
  const slug = deckIdSchema.safeParse(link.slug)
  if (!handle.success || !slug.success) return null
  return sharePath(handle.data, slug.data)
}

/**
 * A deck running in a frame sandboxed like the viewer's own deck. The
 * viewer's script draws it at a full slide's size and scales it down, so a
 * deck laid out for a large screen keeps its layout when shown small.
 */
const deckFrame = (deck: CitedView, href: string) => {
  const name = deck.title ?? deck.slug
  return html`<div class="mini" data-mini>
      <iframe
        data-deck
        src="${deck.contentUrl}"
        title="${name}"
        loading="lazy"
        sandbox="allow-scripts allow-same-origin"
        referrerpolicy="no-referrer"
      ></iframe>
    </div>
    <p>
      <a href="${href}">${name}</a>
      <small>@${deck.handle}</small>
    </p>`
}

/** The origins of the citing and cited decks, which the viewer frames. */
export const deckOriginsOf = (view: ReactionsView): string[] => [
  ...new Set(
    [...view.citedBy.shown, ...view.cites.shown].map(
      (deck) => new URL(deck.contentUrl).origin,
    ),
  ),
]

const deckList = (
  heading: string,
  decks: Shortened<CitedView>,
  lang: Lang,
): Markup =>
  decks.shown.length
    ? html`<section class="cites">
        <h2>${heading}</h2>
        <ul>
          ${decks.shown.map((deck) => {
            const href = deckHref(deck)
            return href ? html`<li>${deckFrame(deck, href)}</li>` : ''
          })}
        </ul>
        ${
          decks.more > 0
            ? html`<p class="more">${text[lang].more(decks.more)}</p>`
            : ''
        }
      </section>`
    : ''

/**
 * The public decks on either side of a citation, shown under the deck: those
 * that link to it, then those it links to. Each runs in its own frame, so
 * each side shows its latest few.
 */
export const citationSections = (view: ReactionsView, lang: Lang) =>
  html`${deckList(text[lang].citedBy, view.citedBy, lang)}
  ${deckList(text[lang].cites, view.cites, lang)}`
