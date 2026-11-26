export const OWNER_COOKIE = '__Host-slide_owner'
/** A sign-in ends after a day without use (F28-AC104). */
export const OWNER_SESSION_SECONDS = 24 * 60 * 60
/** Using the service moves the end forward, at most once an hour. */
export const OWNER_SESSION_RENEW_SECONDS = 60 * 60
