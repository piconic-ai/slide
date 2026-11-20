import { html } from 'hono/html'
import { citationCardGrid, type CitationCard } from '../citations/cards'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: { heading: 'このスライドを引用しているスライド' },
  en: { heading: 'Slides citing these slides' },
})

/**
 * Where the author sees which slides cite theirs: every public deck that
 * links to these slides, newest first, as cover cards. While none does, the
 * frame is left out, heading and all.
 */
export const citedByFrame = (cards: readonly CitationCard[], lang: Lang) =>
  cards.length
    ? html`<section data-deck-frame="cited-by">
        <h2 id="cited-by">${text[lang].heading}</h2>
        ${citationCardGrid(cards, lang, 'cited-by')}
      </section>`
    : ''
