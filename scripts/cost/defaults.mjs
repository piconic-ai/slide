// The default inputs of the cost formula: the per-use counts of per-use.mjs,
// and the assumptions that no local run can measure. Each assumption is
// provisional; docs/dev/scale-cost.md lists them and says what replaces them.
import { PER_USE } from './per-use.mjs'

/** The monthly views of the table in docs/dev/scale-cost.md. */
export const TABLE_VIEWS = [10_000, 100_000, 1_000_000, 10_000_000]

/** The slide size and list screen the defaults use. */
export const DEFAULT_SIZE = 'normal'
export const DEFAULT_LIST = 'topVisitor'

/**
 * Assumptions, not measurements. The ratios tie the other inputs to the
 * monthly views so one number is enough to ask a question.
 */
export const ASSUMPTIONS = {
  /** A slide is opened this many times a month, so slides = views / this. */
  viewsPerSlide: 20,
  /** A share of the stored slides gets a new version each month. */
  uploadsPerSlide: 0.3,
  /** One list screen for every five views. */
  listViewsPerView: 0.2,
  /** Login codes and alerts: one mail for every hundred views. */
  emailsPerView: 0.01,
  /** Covers on the cards of a viewer page (it shows up to 24). */
  coversPerView: 4,
  /** Every view is a first visit: no browser holds the files. */
  revisitShare: 0,
  /** Every file read misses the internal cache and reads R2. */
  cacheHitRate: 0,
  versionsPerSlide: 1,
  /** A normal slide of 30 files. */
  bytesPerVersion: 5 * 1024 * 1024,
  /** The local database of 10,000 slides weighs 821 bytes for each slide. */
  d1BytesPerSlide: 1_000,
  backup: true,
  /** One invocation log for each request. */
  logEventsPerRequest: 1,
  /** The size of one log event is not known; measured in production. */
  logBytesPerEvent: 1_000,
  analyticsPointsPerView: 1,
  analyticsPointsPerUpload: 2,
}

/**
 * The inputs for a month of `views`, with the stored slides, uploads, list
 * screens and mails following from the assumptions. `asOf` is left to the
 * caller, which knows the day.
 *
 * @param {number} views
 * @param {{ size?: keyof typeof PER_USE, list?: keyof typeof PER_USE.list }} [choice]
 */
export function inputsFor(
  views,
  { size = DEFAULT_SIZE, list = DEFAULT_LIST } = {},
) {
  const slides = Math.round(views / ASSUMPTIONS.viewsPerSlide)
  return {
    views,
    slides,
    uploads: Math.round(slides * ASSUMPTIONS.uploadsPerSlide),
    listViews: Math.round(views * ASSUMPTIONS.listViewsPerView),
    emails: Math.round(views * ASSUMPTIONS.emailsPerView),
    coversPerView: ASSUMPTIONS.coversPerView,
    revisitShare: ASSUMPTIONS.revisitShare,
    cacheHitRate: ASSUMPTIONS.cacheHitRate,
    versionsPerSlide: ASSUMPTIONS.versionsPerSlide,
    bytesPerVersion: ASSUMPTIONS.bytesPerVersion,
    d1BytesPerSlide: ASSUMPTIONS.d1BytesPerSlide,
    backup: ASSUMPTIONS.backup,
    logEventsPerRequest: ASSUMPTIONS.logEventsPerRequest,
    logBytesPerEvent: ASSUMPTIONS.logBytesPerEvent,
    analyticsPointsPerView: ASSUMPTIONS.analyticsPointsPerView,
    analyticsPointsPerUpload: ASSUMPTIONS.analyticsPointsPerUpload,
    view: PER_USE[size].view,
    revisit: PER_USE[size].revisit,
    upload: PER_USE[size].upload,
    list: PER_USE.list[list],
    cover: PER_USE.cover,
  }
}
