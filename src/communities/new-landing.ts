/**
 * The page that makes a community as a place a sign-in returns to
 * (F30-AC40): `/communities/new`, with the group's page an event page
 * carried along as `link`. Nothing is made on the way back; the form is only
 * shown again, filled in.
 */
export const NEW_COMMUNITY_LANDING = '/communities/new'

/** The longest link carried through a sign-in; `to` keeps 300 characters. */
export const CARRIED_LINK_MAX = 200

/** The carried link, kept only when it is an http(s) address short enough. */
export function carriedLink(value: string | null | undefined): string | null {
  const link = (value ?? '').trim()
  return link.length > 0 &&
    link.length <= CARRIED_LINK_MAX &&
    /^https?:\/\/[^\s]+$/iu.test(link)
    ? link
    : null
}

/** Where the page that makes a community is, with its first link. */
export const newCommunityPath = (link: string | null) =>
  link === null
    ? NEW_COMMUNITY_LANDING
    : `${NEW_COMMUNITY_LANDING}?link=${encodeURIComponent(link)}`

/**
 * The page that makes a community, if `to` names it: the same path on this
 * service, with no other part than a `link` that passes `carriedLink`.
 * Anything else names nothing, and the sign-in lands where it otherwise
 * would.
 */
export function newCommunityLanding(to: string | undefined): string | null {
  if (to === undefined || !to.startsWith(NEW_COMMUNITY_LANDING)) return null
  let url: URL
  try {
    url = new URL(to, 'https://service.invalid')
  } catch {
    return null
  }
  if (url.origin !== 'https://service.invalid') return null
  if (url.pathname !== NEW_COMMUNITY_LANDING) return null
  return newCommunityPath(carriedLink(url.searchParams.get('link')))
}
