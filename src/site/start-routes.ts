import { Hono } from 'hono'
import { currentOwner } from '../auth/owner-middleware'
import { renderPage } from '../decks/pages'
import { readProfile } from '../profile/store'
import { readHandle } from '../share/store'
import { langOf } from './lang'
import { sessionView } from './session-view'
import { startBody, startTitle } from './start-pages'

export const startRoutes = new Hono<{ Bindings: Env }>()

/** Where signing up and signing in begin; a signed-in author goes on. */
startRoutes.get('/start', async (c) => {
  if (await currentOwner(c, { allowSuspended: true }))
    return c.redirect('/slides', 303)
  const lang = langOf(c)
  return renderPage(c, startTitle(lang), startBody(lang))
})

/** Who is signed in, for the header's menu. It names only the visitor. */
startRoutes.get('/api/session', async (c) => {
  c.header('Cache-Control', 'no-store')
  const owner = await currentOwner(c)
  if (!owner) return c.json(sessionView(null, null, null))
  const [handle, profile] = await Promise.all([
    readHandle(c.env.DB, owner.userId),
    readProfile(c.env.DB, owner.userId),
  ])
  return c.json(sessionView(owner, handle, profile?.avatarUrl ?? null))
})
