const DAY = 24 * 60 * 60

/**
 * A link added to a public slide tells the followers of the community it
 * joins only while the slide is this young (F20-AC16): a link added long
 * after publication is not news. Counted from the first publication.
 */
export const COMMUNITY_NOTICE_WINDOW_SECONDS = 7 * DAY

/** A notice read this long ago is deleted (F20-AC19). */
export const READ_RETENTION_SECONDS = 30 * DAY

/** A notice still unread this long after it arrived is deleted (F20-AC19). */
export const UNREAD_RETENTION_SECONDS = 90 * DAY

/** The earliest first publication that still counts for a link added at `now`; the instant itself counts. */
export const noticeWindowStart = (now: number) =>
  now - COMMUNITY_NOTICE_WINDOW_SECONDS

/**
 * The cut-offs a sweep at `now` uses: a notice read before `read`, or unread
 * and arrived before `unread`, is expired. A notice exactly at the cut-off
 * is kept.
 */
export const retentionCutoffs = (now: number) => ({
  read: now - READ_RETENTION_SECONDS,
  unread: now - UNREAD_RETENTION_SECONDS,
})
