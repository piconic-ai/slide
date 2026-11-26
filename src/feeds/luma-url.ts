/**
 * The one address the service may ask Luma for (D-67): a calendar's iCal
 * feed, https://api.luma.com/ics/get?entity=calendar&id=cal-…. The host and the
 * path are fixed here, and nowhere else is a request to Luma built.
 */

/** The origin of every request to Luma. */
export const LUMA_FEED_ORIGIN = 'https://api.luma.com'

/** The path of a calendar's feed. */
export const LUMA_FEED_PATH = '/ics/get'

/**
 * A calendar's id, as a feed's query names it. A community's Luma link is
 * read with the same pattern (communities/link-rules.ts).
 */
export const LUMA_CALENDAR_ID = /^cal-[A-Za-z0-9]{1,64}$/u

/** The feed address of a calendar, as the service writes it. */
export const lumaFeedUrl = (calendarId: string) =>
  `${LUMA_FEED_ORIGIN}${LUMA_FEED_PATH}?entity=calendar&id=${calendarId}`

/**
 * The address to ask for, or null when it is not a calendar's feed written
 * the one way the service writes it: https, the host api.luma.com with no port,
 * user or password, the path /ics/get, the query `entity=calendar&id=cal-…`
 * and nothing else, no fragment. Anything else is never asked for.
 */
export function lumaFeedTarget(address: string): string | null {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return null
  }
  const keys = [...url.searchParams.keys()]
  const id = url.searchParams.get('id') ?? ''
  if (
    url.origin !== LUMA_FEED_ORIGIN ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== LUMA_FEED_PATH ||
    url.hash !== '' ||
    keys.length !== 2 ||
    url.searchParams.get('entity') !== 'calendar' ||
    !LUMA_CALENDAR_ID.test(id)
  )
    return null
  const target = lumaFeedUrl(id)
  // The address must already be in that form: what is asked for is what
  // was checked, byte for byte.
  return address === target ? target : null
}
