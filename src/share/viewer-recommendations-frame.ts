import type { Lang } from '../site/i18n'

/**
 * Where the viewer shows, under everything else, the other talks of the same
 * event and of the same community's other events (D-56 decides which of the
 * two sections stand). Two frames, one per section. Nothing yet; the work on
 * the viewer fills them, and a section with nothing in it is not drawn,
 * heading included.
 */

/** The section of the other talks of the same event. */
export const viewerSameEventFrame = (_lang: Lang) => ''

/** The section of the talks of the same community's other events. */
export const viewerSameCommunityFrame = (_lang: Lang) => ''
