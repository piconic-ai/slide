/**
 * What a follow button of the top page's carousels sends (F44-AC21). The
 * page is static, so the button asks the service's own forms for JSON, as
 * /share.js does for the follow button of a profile. This file reaches the
 * browser, so it holds no parser.
 */

/** What a card's button follows. */
export type FollowKind = 'person' | 'community'

/** A request for the forms that follow and unfollow. */
export type FollowRequest = Readonly<{
  path: string
  /** The form fields, sent as `application/x-www-form-urlencoded`. */
  fields: Readonly<Record<string, string>>
}>

/** Where the sign-in leads back to: the top page (src/auth/landing.ts). */
export const FOLLOW_RETURN = '/'

/**
 * The request that follows (`release` false) or unfollows (`release` true)
 * the person or community `handle` names. The forms' own names: a person's
 * are in src/follows/routes.ts, a community's in
 * src/communities/follow-frames.ts.
 */
export const followRequest = (
  kind: FollowKind,
  handle: string,
  release: boolean,
): FollowRequest => {
  if (kind === 'person')
    return {
      path: release
        ? `/follows/${encodeURIComponent(handle)}/release`
        : '/follows',
      fields: { handle, slide: FOLLOW_RETURN },
    }
  return {
    path: release ? '/communities/follows/release' : '/communities/follows',
    fields: { handle, back: FOLLOW_RETURN },
  }
}

/**
 * Whether the "following" list shown is older than the follows (F44-AC26):
 * `changes` counts the follows and unfollows that succeeded, `loaded` the
 * count the list was asked for at. A list that is not in view is left as it
 * is, and asked for once its tab is chosen.
 */
export const followListStale = (
  changes: number,
  loaded: number,
  active: boolean,
): boolean => active && changes !== loaded

/** The sign-in prompt a visitor who is not signed in gets (F44-AC22). */
export const followPromptKind = (kind: FollowKind) =>
  kind === 'person' ? 'follow' : 'follow-community'
