import { CONTACT_ADDRESS } from '../site/legal-pages'
import { mailerOf } from '../mail/mailer-routes'
import { normalizeAddress } from '../mail/address'
import { dropOldAlerts, listQueued, markMailed } from './alert-store'
import { dayOf, digestOf } from './digest-text'

const log = (line: Record<string, unknown>) => console.log(JSON.stringify(line))

/** Where the next-day mail goes: `ALERT_MAIL_TO`, else the contact address (D-59). */
function recipientOf(env: Env): string {
  if (!env.ALERT_MAIL_TO) return CONTACT_ADDRESS
  const to = normalizeAddress(env.ALERT_MAIL_TO)
  if (to) return to
  // The setting is not an address; it is not printed.
  log({ event: 'alert_mail_to_invalid' })
  return CONTACT_ADDRESS
}

/**
 * The next-day mail (F39-AC7, F39-AC8): what waits in D1 goes in one mail, to
 * the operator, and is marked as mailed. With nothing waiting no mail is
 * sent. Without a mail service the alerts stay queued. A mail that fails to
 * go raises the failure to the caller, and the alerts stay queued and go the
 * next day with the rest. Only rows that were waiting when the mail was made
 * are marked, so an alert raised meanwhile goes in the next one.
 */
export async function sendDigest(env: Env, at: number) {
  await dropOldAlerts(env.DB, at)
  const queued = await listQueued(env.DB)
  const last = queued.at(-1)
  if (!last) return { rows: 0, sent: false }
  const mailer = mailerOf(env)
  if (!mailer) {
    log({ event: 'alert_digest_not_sent', reason: 'mail_unset' })
    return { rows: 0, sent: false }
  }
  const digest = digestOf(queued, dayOf(at), env.OPERATOR_ORIGIN)
  if (digest) await mailer({ to: recipientOf(env), ...digest })
  else log({ event: 'alert_digest_empty', rows: queued.length })
  await markMailed(env.DB, last.id, at)
  return { rows: queued.length, sent: digest !== null }
}
