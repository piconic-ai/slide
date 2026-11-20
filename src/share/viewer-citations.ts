import { html } from 'hono/html'
import { citationCardGrid, type CitationCard } from '../citations/cards'
import type { Shortened } from '../citations/citing'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    cites: 'このスライドが引用しているスライド',
    citedBy: 'このスライドを引用しているスライド',
    more: (count: number) => `ほか ${count} 件`,
  },
  en: {
    cites: 'Slides these slides cite',
    citedBy: 'Slides citing these slides',
    more: (count: number) => `${count} more`,
  },
})

/** Both sides of a deck's citations, cut to what the viewer shows. */
export type ViewerCitations = Readonly<{
  cites: Shortened<CitationCard>
  citedBy: Shortened<CitationCard>
}>

/**
 * One side's place. With nothing to show it holds nothing at all, not even
 * white space: an empty place is matched as empty and takes no room.
 */
const side = (
  name: 'cites' | 'cited-by',
  heading: string,
  list: Shortened<CitationCard>,
  lang: Lang,
) =>
  list.shown.length
    ? html`<div data-reader-lists="${name}">
        <section class="citations">
          <h2 id="${name}">${heading}</h2>
          ${citationCardGrid(list.shown, lang, name, 4)}
          ${
            list.more > 0
              ? html`<p class="citations-more">
                  ${text[lang].more(list.more)}
                </p>`
              : ''
          }
        </section>
      </div>`
    : html`<div data-reader-lists="${name}"></div>`

/**
 * Where the viewer lists the slides these slides cite, and the slides that
 * cite them, as cover cards: no cited deck runs here. A side with nothing to
 * show leaves its place empty, heading and all. /share.js replaces the two
 * places by these names after a reader mutes or releases the author, so the
 * places are always there.
 */
export const viewerCitations = (view: ViewerCitations, lang: Lang) =>
  html`${side('cites', text[lang].cites, view.cites, lang)}
  ${side('cited-by', text[lang].citedBy, view.citedBy, lang)}`
