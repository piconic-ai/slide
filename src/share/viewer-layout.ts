/**
 * How the viewer lays out what is under and beside the slides. The reader
 * picks one; it is kept in their browser and applied by `/share.js`, which
 * sets `data-layout` on the viewer. CSS does the rest, so the markup keeps
 * one order whichever layout shows.
 *
 * - stack: everything in one column, as the viewer always was.
 * - side: slides, title and article on the left; author, description,
 *   related links and citations stay on the right while the article is read.
 * - wide: the slides across the whole screen; below them, the same two columns.
 */
export const VIEWER_LAYOUTS = ['stack', 'side', 'wide'] as const
export type ViewerLayout = (typeof VIEWER_LAYOUTS)[number]

/** What the viewer shows before the reader has chosen, and when a choice is unusable. */
export const DEFAULT_VIEWER_LAYOUT: ViewerLayout = 'stack'

/** The browser's storage key; `/share.js` uses the same literal. */
export const VIEWER_LAYOUT_KEY = 'slide-viewer-layout'

/** A screen this wide or narrower always shows the stack, and offers no choice. */
export const NARROW_SCREEN_MAX = 760

/** Reads what the browser kept. Anything but a known name is no choice. */
export const parseStoredLayout = (stored: unknown): ViewerLayout =>
  VIEWER_LAYOUTS.find((layout) => layout === stored) ?? DEFAULT_VIEWER_LAYOUT

/** The layout a screen of this width shows for what the reader chose. */
export const layoutForWidth = (
  chosen: ViewerLayout,
  width: number,
): ViewerLayout => (width <= NARROW_SCREEN_MAX ? 'stack' : chosen)
