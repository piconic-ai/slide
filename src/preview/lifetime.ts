/** How long an issued launch token can be consumed. */
export const LAUNCH_SECONDS = 60
/** An author keeps at most this many launches that are not yet used. */
export const MAX_UNUSED_LAUNCHES = 20
/**
 * A frame's session, in the viewer, is a cookie kept in a third-party
 * context. It lives this long and is never renewed; the viewer opens the
 * slides again when it is shown after that.
 */
export const FRAME_SESSION_SECONDS = 5 * 60

export type SessionTimes = Readonly<{
  createdAt: number
  expiresAt: number
  hardExpiresAt: number
}>

/** The times of a session opened in the viewer's frame. */
export function frameSessionTimes(now: number): SessionTimes {
  return {
    createdAt: now,
    expiresAt: now + FRAME_SESSION_SECONDS,
    hardExpiresAt: now + FRAME_SESSION_SECONDS,
  }
}
