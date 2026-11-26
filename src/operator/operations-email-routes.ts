import type { Hono } from 'hono'
import { EmailCryptoError } from '../db/email-cipher'
import { emailCryptoOf } from '../db/email-settings'
import { rewriteEmails } from '../db/email-rewrite-store'
import type { OperatorEnv } from './operator-env'

/**
 * `POST /operations/email/rewrite`: one press of "書き換える". The form
 * comes from this origin only, like every other change an operator makes.
 * The log line holds counts and an error code, never an address.
 */
export function mountEmailRewrite(app: Hono<OperatorEnv>) {
  app.post('/operations/email/rewrite', async (c) => {
    if (c.req.header('Origin') !== new URL(c.req.url).origin)
      return c.text('Forbidden', 403)
    try {
      const result = await rewriteEmails(c.env.DB, emailCryptoOf(c.env))
      console.log(JSON.stringify({ event: 'email_rewrite', ...result }))
    } catch (error) {
      if (!(error instanceof EmailCryptoError)) throw error
      console.warn(
        JSON.stringify({ event: 'email_rewrite_refused', code: error.code }),
      )
    }
    return c.redirect('/operations#email', 303)
  })
}
