import { recordFrom } from '../metrics/record-routes'
import { Hono, type Context } from 'hono'
import { csrf } from 'hono/csrf'
import { currentOwner } from '../auth/owner-middleware'
import { readCitedCounts } from '../citations/pair-store'
import { homePagePolicy, renderPage } from '../decks/pages'
import { parsePeoplePage } from '../follows/people'
import { contentBaseOf } from '../preview/config'
import { toCommunityRecentDeck } from '../site/home-communities'
import { FOLLOWED_COMMUNITY_TALKS_PATH } from '../site/home-shape'
import { langOf } from '../site/lang'
import { handleSchema } from '../share/handle'
import { returnToShare } from '../share/path'
import { formOnly } from '../site/form-only-middleware'
import { afterChange, signedOut } from '../site/form-response-routes'
import {
  FOLLOWED_TALKS_PER_PAGE,
  followedTalksBody,
  followedTalksTitle,
} from './feed-page'
import {
  countFollowedCommunityTalks,
  listFollowedCommunityTalks,
} from './feed-store'
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

/**
 * Every slide of the communities the reader follows, the list "see all" on
 * the top page leads to (F31-AC5). It is the reader's own, so someone not
 * signed in is sent to sign in.
 */
communityFollowForms.get(FOLLOWED_COMMUNITY_TALKS_PATH, async (c) => {
  const owner = await currentOwner(c)
  if (!owner) return c.redirect('/login', 303)
  const page = parsePeoplePage(c.req.query('page') ?? null)
  if (page === null) return c.notFound()
  const [shown, total] = await Promise.all([
    listFollowedCommunityTalks(c.env.DB, {
      viewer: owner.userId,
      limit: FOLLOWED_TALKS_PER_PAGE,
      offset: (page - 1) * FOLLOWED_TALKS_PER_PAGE,
    }),
    countFollowedCommunityTalks(c.env.DB, owner.userId),
  ])
  const citedBy = await readCitedCounts(
    c.env.DB,
    shown.map((talk) => talk.handle),
    owner.userId,
  )
  const contentBase = contentBaseOf(c.env)
  const lang = langOf(c)
  return renderPage(
    c,
    followedTalksTitle(lang),
    followedTalksBody(
      {
        decks: shown.map((talk) =>
          toCommunityRecentDeck(talk, contentBase, citedBy),
        ),
        page,
        total,
      },
      lang,
    ),
    200,
    homePagePolicy(contentBase),
  )
})
