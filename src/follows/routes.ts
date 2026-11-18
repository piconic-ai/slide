import { Hono, type Context } from 'hono'
import { csrf } from 'hono/csrf'
import { currentOwner } from '../auth/owner-middleware'
import { accountTitles, renderPage } from '../decks/pages'
import { hasMuted } from '../mutes/store'
import { returnToShare } from '../share/path'
import { findAuthor, findVisibleAuthor } from '../share/store'
import { langOf } from '../site/lang'
import {
  followFormBody,
  followSignInBody,
  followTitle,
  mutedFollowBody,
} from './pages'
import { follow, isFollowing, unfollow } from './store'

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
  const following = await isFollowing(c.env.DB, {
    follower: owner.userId,
    followee: author.userId,
  })
  return renderPage(
    c,
    followTitle(lang),
    followFormBody(author.handle, slide, following, lang),
  )
})

followForms.post('/', csrf(), async (c) => {
  const form = await c.req.parseBody({ all: true })
  const slide = returnToShare(form.slide)
  const owner = await currentOwner(c)
  if (!owner) return signInPage(c, slide)
  const author = await findVisibleAuthor(c.env.DB, form.handle)
  if (author)
    await follow(c.env.DB, {
      follower: owner.userId,
      followee: author.userId,
      now: Math.floor(Date.now() / 1000),
    })
  return c.redirect(slide, 303)
})

followForms.post('/:handle/release', csrf(), async (c) => {
  const form = await c.req.parseBody({ all: true })
  const back =
    form.slide === undefined ? '/settings' : returnToShare(form.slide)
  const owner = await currentOwner(c)
  // Returning to the slide would look as if the release had worked.
  if (!owner && form.slide !== undefined) return signInPage(c, back)
  const author = owner && (await findAuthor(c.env.DB, c.req.param('handle')))
  if (owner && author)
    await unfollow(c.env.DB, {
      follower: owner.userId,
      followee: author.userId,
    })
  return c.redirect(back, 303)
})
