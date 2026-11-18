import { Hono, type Context } from 'hono'
import { csrf } from 'hono/csrf'
import { currentOwner } from '../auth/owner-middleware'
import { renderPage } from '../decks/pages'
import { parseSharePath } from '../share/path'
import { findAuthor, findVisibleAuthor } from '../share/store'
import { formOnly } from '../site/form-only-middleware'
import { afterChange, signedOut } from '../site/form-response-routes'
import { langOf } from '../site/lang'
import { muteFormBody, muteSignInBody, muteTitle } from './pages'
import { hasMuted, mute, unmute } from './store'

export const muteForms = new Hono<{ Bindings: Env }>()

function returnToSlide(input: unknown) {
  if (typeof input !== 'string') return '/slides'
  const path = parseSharePath(input)
  return path.kind === 'deck' || path.kind === 'page' ? input : '/slides'
}

function signInPage(c: Context<{ Bindings: Env }>, slide: string) {
  const lang = langOf(c)
  return renderPage(c, muteTitle(lang), muteSignInBody(slide, lang), 401)
}

function afterMute(
  c: Context<{ Bindings: Env }>,
  pair: Parameters<typeof hasMuted>[1] | null,
  back: string,
) {
  return afterChange(c, back, async () => ({
    muted: pair !== null && (await hasMuted(c.env.DB, pair)),
  }))
}

muteForms.get('/new', async (c) => {
  const author = await findVisibleAuthor(c.env.DB, c.req.query('handle'))
  if (!author) return c.notFound()
  const owner = await currentOwner(c)
  if (owner?.userId === author.userId) return c.notFound()
  const slide = returnToSlide(c.req.query('slide'))
  if (!owner) return signInPage(c, slide)
  const lang = langOf(c)
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
  if (!owner) return signedOut(c, () => signInPage(c, slide))
  const author = await findVisibleAuthor(c.env.DB, form.handle)
  const pair = author && { muter: owner.userId, muted: author.userId }
  if (pair)
    await mute(c.env.DB, { ...pair, now: Math.floor(Date.now() / 1000) })
  return afterMute(c, pair, slide)
})

muteForms.post('/:handle/release', formOnly, csrf(), async (c) => {
  const owner = await currentOwner(c)
  if (!owner) return signedOut(c, () => c.redirect('/settings', 303))
  const author = await findAuthor(c.env.DB, c.req.param('handle'))
  const pair = author && { muter: owner.userId, muted: author.userId }
  if (pair) await unmute(c.env.DB, pair)
  return afterMute(c, pair, '/settings')
})
