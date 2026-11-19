import { html } from 'hono/html'

/**
 * Where the author sees which slides cite theirs. For now only the place is
 * kept: the citation feature fills it with a heading and the list, newest
 * first.
 */
export const citedByFrame = () =>
  html`<section data-deck-frame="cited-by"></section>`
