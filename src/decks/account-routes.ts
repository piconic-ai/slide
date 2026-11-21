import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { requireOwnerEvenSuspended } from '../auth/owner-middleware'
import { endOwnerSession, type Owner } from '../auth/owner-session'
import { markAccountDeleted } from './deletion-store'
import { langOf } from '../site/lang'
import { accountMismatchBody, accountTitles, renderPage } from './pages'

/** Browser form endpoints for the signed-in account. */
export const accountForms = new Hono<{
  Bindings: Env
  Variables: { owner: Owner }
}>()

accountForms.post('/delete', csrf(), requireOwnerEvenSuspended, async (c) => {
  const owner = c.get('owner')
  const form = await c.req.parseBody()
  // Handles are lowercase; the confirmation is read the same way.
  const typed = String(form.confirm ?? '').trim()
  if (typed.toLowerCase() !== owner.login.toLowerCase()) {
    const lang = langOf(c)
    return renderPage(
      c,
      accountTitles(lang).deleteAccountFailedTitle,
      accountMismatchBody(lang),
      400,
    )
  }
  await markAccountDeleted(c.env.DB, {
    ownerUserId: owner.userId,
    now: Math.floor(Date.now() / 1000),
  })
  // The session row is already gone; this clears the cookie.
  await endOwnerSession(c)
  return c.redirect('/', 303)
})
