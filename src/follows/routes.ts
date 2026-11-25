import { Hono, type Context } from 'hono'
import { csrf } from 'hono/csrf'
import { currentOwner } from '../auth/owner-middleware'
import { accountTitles, renderPage } from '../decks/pages'
import { hasMuted } from '../mutes/store'
import { blockedBetween } from '../blocks/store'
import { returnToShare } from '../share/path'
import { findAuthor, findVisibleAuthor } from '../share/store'
import { formOnly } from '../site/form-only-middleware'
import { afterChange, signedOut } from '../site/form-response-routes'
import { langOf } from '../site/lang'
import {
  followFormBody,
  followSignInBody,
  followTitle,
  mutedFollowBody,
  refusedFollowBody,
} from './pages'
import { follow, isFollowing, unfollow, type FollowPair } from './store'

export const followForms = new Hono<{ Bindings: Env }>()

function signInPage(c: Context<{ Bindings: Env }>, slide: string) {
  const lang = langOf(c)
  return renderPage(
    c,
    followTitle(lang),
    followSignInBody(slide, accountTitles(lang).signInLink, lang),
    401,
  )
}

followForms.get('/new', async (c) => {
  const author = await findVisibleAuthor(c.env.DB, c.req.query('handle'))
  if (!author) return c.notFound()
  const owner = await currentOwner(c)
  if (owner?.userId === author.userId) return c.notFound()
  const slide = returnToShare(c.req.query('slide'))
  if (!owner) return signInPage(c, slide)

  const lang = langOf(c)
  const muted = await hasMuted(c.env.DB, {
    muter: owner.userId,
    muted: author.userId,
  })
  if (muted)
    return renderPage(
      c,
      followTitle(lang),
      mutedFollowBody(author.handle, slide, lang),
    )
  // Only that following is not possible; never who blocked whom.
  if (await blockedBetween(c.env.DB, owner.userId, author.userId))
    return renderPage(c, followTitle(lang), refusedFollowBody(slide, lang))
  const following = await isFollowing(c.env.DB, {
    follower: owner.userId,
    followee: author.userId,
  })
  return renderPage(
    c,
    followTitle(lang, following),
    followFormBody(author.handle, slide, following, lang),
  )
})

function afterFollow(
  c: Context<{ Bindings: Env }>,
  pair: FollowPair | null,
  back: string,
) {
  return afterChange(c, back, async () => ({
    following: pair !== null && (await isFollowing(c.env.DB, pair)),
  }))
}

followForms.post('/', formOnly, csrf(), async (c) => {
  const form = await c.req.parseBody({ all: true })
  const slide = returnToShare(form.slide)
  const owner = await currentOwner(c)
  if (!owner) return signedOut(c, () => signInPage(c, slide))
  const author = await findVisibleAuthor(c.env.DB, form.handle)
  const pair = author && { follower: owner.userId, followee: author.userId }
  if (pair)
    await follow(c.env.DB, { ...pair, now: Math.floor(Date.now() / 1000) })
  return afterFollow(c, pair, slide)
})

followForms.post('/:handle/release', formOnly, csrf(), async (c) => {
  const form = await c.req.parseBody({ all: true })
  const back = returnToShare(form.slide)
  const owner = await currentOwner(c)
  if (!owner) return signedOut(c, () => signInPage(c, back))
  const author = await findAuthor(c.env.DB, c.req.param('handle'))
  const pair = author && { follower: owner.userId, followee: author.userId }
  if (pair) await unfollow(c.env.DB, pair)
  return afterFollow(c, pair, back)
})
