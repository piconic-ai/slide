import { Hono } from 'hono'
import { currentOwner } from '../auth/owner-session'
import { renderPage } from '../decks/pages'
import { readHandle } from '../share/store'
import { langOf } from './lang'
import { sessionView } from './session-view'
import { startBody, startTitle } from './start-pages'

export const startRoutes = new Hono<{ Bindings: Env }>()

/** Where signing up and signing in begin; a signed-in author goes on. */
startRoutes.get('/start', async (c) => {
  if (await currentOwner(c)) return c.redirect('/decks', 303)
  const lang = langOf(c)
  return renderPage(c, startTitle(lang), startBody(lang))
})

/** Who is signed in, for the header's menu. It names only the visitor. */
startRoutes.get('/api/session', async (c) => {
  c.header('Cache-Control', 'no-store')
  const owner = await currentOwner(c)
  const handle = owner ? await readHandle(c.env.DB, owner.userId) : null
  return c.json(sessionView(owner, handle))
})
