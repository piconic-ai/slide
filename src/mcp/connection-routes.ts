import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { currentOwner } from '../auth/owner-middleware'
import { accountTitles, renderPage, signInPrompt } from '../decks/pages'
import { langOf } from '../site/lang'
import { revokeConnection } from './connections-store'

/** The settings' action on the agents an author connected. */
export const connectionRoutes = new Hono<{ Bindings: Env }>()

connectionRoutes.post('/settings/agents/:id/revoke', csrf(), async (c) => {
  const owner = await currentOwner(c)
  const lang = langOf(c)
  if (!owner)
    return renderPage(
      c,
      accountTitles(lang).signInTitle,
      signInPrompt(lang),
      401,
    )
  await revokeConnection(
    c.env.DB,
    owner.userId,
    c.req.param('id'),
    Math.floor(Date.now() / 1000),
  )
  return c.redirect('/settings#agents', 303)
})
