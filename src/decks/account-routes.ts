import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { requireOwnerEvenSuspended } from '../auth/owner-middleware'
import { endOwnerSession, type Owner } from '../auth/owner-session'
import { markAccountDeleted } from './deletion-store'
import { deleteFaces } from '../profile/picture-store'
import { GOODBYE_PATH } from '../site/goodbye-page'
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
  // The rows are gone; the pictures kept in R2 go after them, so a failure
  // here leaves objects nobody can ask for, not a person who cannot leave.
  await deleteFaces(c.env.UPLOADS, owner.userId)
  // The session row is already gone; this clears the cookie.
  await endOwnerSession(c)
  // The cookie is cleared above; the page tells them it is done.
  return c.redirect(GOODBYE_PATH, 303)
})
