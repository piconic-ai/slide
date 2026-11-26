import type { Mailer } from './mail'
import { cloudflareMailer } from './mail-client'
import { writeOutbox } from './outbox-store'

const now = () => Math.floor(Date.now() / 1000)

/**
 * Where mail goes: a real service when set up, else the local outbox, else
 * nowhere (null). The login codes and the next-day alerts share this one
 * way out.
 */
export function mailerOf(env: Env): Mailer | null {
  if (env.MAIL_API_TOKEN && env.MAIL_ACCOUNT_ID && env.MAIL_FROM)
    return cloudflareMailer({
      accountId: env.MAIL_ACCOUNT_ID,
      apiToken: env.MAIL_API_TOKEN,
      from: env.MAIL_FROM,
    })
  if (env.MAIL_OUTBOX === 'on')
    return (mail) => writeOutbox(env.DB, mail, now())
  return null
}
