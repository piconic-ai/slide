import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { currentOwner } from '../auth/owner-middleware'
import { renderPage } from '../decks/pages'
import { parseSharePath } from '../share/path'
import { findAuthor, findVisibleAuthor } from '../share/store'
import { formOnly } from '../site/form-only-middleware'
import { langOf } from '../site/lang'
import { muteFormBody, muteSignInBody, muteTitle } from './pages'
import { mute, unmute } from './store'

export const muteForms = new Hono<{ Bindings: Env }>()

function returnToSlide(input: unknown) {
  if (typeof input !== 'string') return '/slides'
  const path = parseSharePath(input)
  return path.kind === 'deck' || path.kind === 'page' ? input : '/slides'
}

muteForms.get('/new', async (c) => {
  const author = await findVisibleAuthor(c.env.DB, c.req.query('handle'))
  if (!author) return c.notFound()
  const owner = await currentOwner(c)
  if (owner?.userId === author.userId) return c.notFound()
  const slide = returnToSlide(c.req.query('slide'))
  const lang = langOf(c)
  if (!owner)
    return renderPage(c, muteTitle(lang), muteSignInBody(slide, lang), 401)
  return renderPage(
    c,
    muteTitle(lang),
    muteFormBody(author.handle, slide, lang),
  )
})

muteForms.post('/', formOnly, csrf(), async (c) => {
  const form = await c.req.parseBody({ all: true })
  const slide = returnToSlide(form.slide)
  const owner = await currentOwner(c)
  // A session that ended while the form was open gets the sign-in page,
  // not a bare API error.
  if (!owner) {
    const lang = langOf(c)
    return renderPage(c, muteTitle(lang), muteSignInBody(slide, lang), 401)
  }
  const author = await findVisibleAuthor(c.env.DB, form.handle)
  if (author)
    await mute(c.env.DB, {
      muter: owner.userId,
      muted: author.userId,
      now: Math.floor(Date.now() / 1000),
    })
  return c.redirect(slide, 303)
})

muteForms.post('/:handle/release', formOnly, csrf(), async (c) => {
  const owner = await currentOwner(c)
  const author = owner && (await findAuthor(c.env.DB, c.req.param('handle')))
  if (owner && author)
    await unmute(c.env.DB, { muter: owner.userId, muted: author.userId })
  // Signed out, the settings page asks them to sign in.
  return c.redirect('/settings', 303)
})
