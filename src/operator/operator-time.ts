import { html } from 'hono/html'

/**
 * How every operator page shows a moment: ISO 8601 in UTC, as the operator's
 * pages always have, so that the same moment reads the same on every page.
 */
export const isoOf = (seconds: number) => new Date(seconds * 1000).toISOString()

/** A `<time>` that shows `isoOf`; `none` is what a missing moment reads as. */
export const timeTag = (seconds: number | null, none = 'まだありません') =>
  seconds === null
    ? html`${none}`
    : html`<time datetime="${isoOf(seconds)}">${isoOf(seconds)}</time>`
