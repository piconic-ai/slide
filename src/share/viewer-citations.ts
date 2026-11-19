import { html } from 'hono/html'

/**
 * Where the viewer lists the slides these slides cite, and the slides that
 * cite them. For now only the places are kept: the citation feature fills
 * each with a heading and cover cards, and leaves it empty, so that nothing
 * shows, when there is none. /share.js replaces the two lists by these names
 * after a reader mutes the author.
 */
export const viewerCitations = () =>
  html`<div data-reader-lists="cites"></div>
    <div data-reader-lists="cited-by"></div>`
