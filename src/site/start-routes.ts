import { Hono } from 'hono'
import { currentOwner } from '../auth/owner-middleware'
import { countUnread } from '../notifications/store'
import { readProfile } from '../profile/store'
import { readHandle } from '../share/store'
import { sessionView } from './session-view'

export const startRoutes = new Hono<{ Bindings: Env }>()

/**
 * The page that explained signing in is gone: the top page is where slides
 * are put, and the header's way in goes straight to GitHub. Old links land
 * on the top page.
 */
startRoutes.get('/start', (c) => c.redirect('/', 303))

/** Who is signed in, for the header's menu. It names only the visitor. */
startRoutes.get('/api/session', async (c) => {
  c.header('Cache-Control', 'no-store')
  const owner = await currentOwner(c)
  if (!owner) return c.json(sessionView(null, null, null))
  const [handle, profile, unread] = await Promise.all([
    readHandle(c.env.DB, owner.userId),
    readProfile(c.env.DB, owner.userId),
    // The dot only adds to the header; it is drawn without it.
    countUnread(c.env.DB, owner.userId).catch(() => 0),
  ])
  return c.json(
    sessionView(owner, handle, profile?.avatarUrl ?? null, unread > 0),
  )
})
