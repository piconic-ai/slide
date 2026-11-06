import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import {
  endOwnerSession,
  requireOwner,
  type Owner,
} from '../auth/owner-session'
import { markAccountDeleted } from './deletion'
import { accountMismatchBody, renderPage } from './pages'

/** Browser form endpoints for the signed-in account. */
export const accountForms = new Hono<{
  Bindings: Env
  Variables: { owner: Owner }
}>()

accountForms.post('/delete', csrf(), requireOwner, async (c) => {
  const owner = c.get('owner')
  const form = await c.req.parseBody()
  if (String(form.confirm ?? '').trim() !== owner.login)
    return renderPage(c, '退会できませんでした', accountMismatchBody, 400)
  await markAccountDeleted(c.env.DB, {
    ownerUserId: owner.userId,
    now: Math.floor(Date.now() / 1000),
  })
  // The session row is already gone; this clears the cookie.
  await endOwnerSession(c)
  return c.redirect('/', 303)
})
