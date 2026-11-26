/**
 * The shapes the page to frame comes in. `full` has the line under the
 * slides (title, author, link); `compact` has only the slides, filling the
 * frame. Only the home timeline asks for `compact`.
 */
export type EmbedShape = 'full' | 'compact'

/** The value of the `t` query that asks for the compact shape. */
export const COMPACT_SHAPE = 'compact'

/** Anything but exactly `compact` is the shape the page always had. */
export const embedShapeOf = (t: string | null | undefined): EmbedShape =>
  t === COMPACT_SHAPE ? 'compact' : 'full'

/**
 * Where a view of the page to frame is recorded as coming from. Only the
 * timeline uses the compact shape, so it is told apart from blog embeds.
 */
export const embedViaOf = (shape: EmbedShape): 'embed' | 'timeline' =>
  shape === 'compact' ? 'timeline' : 'embed'
