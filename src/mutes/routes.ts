import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { currentOwner, requireOwner } from '../auth/owner-middleware'
import type { Owner } from '../auth/owner-session'
import { renderPage } from '../decks/pages'
import { handleSchema } from '../share/handle'
import { parseSharePath } from '../share/path'
import { readHandleOwner } from '../share/store'
import { langOf } from '../site/lang'
import { muteFormBody, muteSignInBody, muteTitle } from './pages'
import { mute, unmute } from './store'

export const muteForms = new Hono<{
  Bindings: Env
  Variables: { owner: Owner }
}>()

function returnToSlide(input: unknown) {
  if (typeof input !== 'string') return '/slides'
  const path = parseSharePath(input)
  return path.kind === 'deck' || path.kind === 'page' ? input : '/slides'
}

async function findAuthor(database: D1Database, input: unknown) {
  const handle = handleSchema.safeParse(input)
  if (!handle.success) return null
  const userId = await readHandleOwner(database, handle.data)
  return userId === null ? null : { handle: handle.data, userId }
}

muteForms.get('/new', async (c) => {
  const author = await findAuthor(c.env.DB, c.req.query('handle'))
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

muteForms.post('/', csrf(), requireOwner, async (c) => {
  const form = await c.req.parseBody({ all: true })
  const author = await findAuthor(c.env.DB, form.handle)
  if (author)
    await mute(c.env.DB, {
      muter: c.get('owner').userId,
      muted: author.userId,
      now: Math.floor(Date.now() / 1000),
    })
  return c.redirect(returnToSlide(form.slide), 303)
})

muteForms.post('/:handle/release', csrf(), requireOwner, async (c) => {
  const author = await findAuthor(c.env.DB, c.req.param('handle'))
  if (author)
    await unmute(c.env.DB, {
      muter: c.get('owner').userId,
      muted: author.userId,
    })
  return c.redirect('/settings', 303)
})
