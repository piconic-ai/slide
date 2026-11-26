import { recordFrom } from '../metrics/record-routes'
import { Hono, type Context } from 'hono'
import { csrf } from 'hono/csrf'
import { currentOwner } from '../auth/owner-middleware'
import { handleSchema } from '../share/handle'
import { returnToShare } from '../share/path'
import { formOnly } from '../site/form-only-middleware'
import { afterChange, signedOut } from '../site/form-response-routes'
import { COMMUNITY_FOLLOW_PATH, COMMUNITY_RELEASE_PATH } from './follow-frames'
import {
  findCommunityIdByHandle,
  followCommunity,
  isFollowingCommunity,
  unfollowCommunity,
  type CommunityFollowPair,
} from './follow-store'

/** The forms that follow and unfollow a community (F31-AC1, F31-AC2). */
export const communityFollowForms = new Hono<{ Bindings: Env }>()

/** Answers whether the change was a new follow, which is the one counted. */
type Change = (
  database: D1Database,
  pair: CommunityFollowPair,
) => Promise<unknown>

/**
 * Reads the form, then makes the change for the signed-in reader and the
 * community that holds the handle; a handle no community holds changes
 * nothing. The reader returns to `back`, or, asking for JSON, learns
 * whether they follow it now. A reader who is not signed in is sent to sign
 * in and back, and nothing is changed: the follow is not carried over.
 */
async function changeFollow(c: Context<{ Bindings: Env }>, change: Change) {
  const form = await c.req.parseBody()
  const back = returnToShare(form.back)
  const owner = await currentOwner(c)
  if (!owner)
    return signedOut(c, () =>
      c.redirect(`/login?to=${encodeURIComponent(back)}`, 303),
    )
  const handle = handleSchema.safeParse(form.handle)
  const communityId = handle.success
    ? await findCommunityIdByHandle(c.env.DB, handle.data)
    : null
  const pair =
    communityId === null ? null : { userId: owner.userId, communityId }
  if (pair && (await change(c.env.DB, pair)) === true)
    recordFrom(c, {
      name: 'community_followed',
      communityId: String(pair.communityId),
    })
  return afterChange(c, back, async () => ({
    following: pair !== null && (await isFollowingCommunity(c.env.DB, pair)),
  }))
}

communityFollowForms.post(COMMUNITY_FOLLOW_PATH, formOnly, csrf(), (c) =>
  changeFollow(c, (database, pair) =>
    followCommunity(database, {
      ...pair,
      now: Math.floor(Date.now() / 1000),
    }),
  ),
)

communityFollowForms.post(COMMUNITY_RELEASE_PATH, formOnly, csrf(), (c) =>
  changeFollow(c, unfollowCommunity),
)
