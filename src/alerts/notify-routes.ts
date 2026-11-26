import { claimImmediate, finishImmediate, queueNextDay } from './alert-store'
import { postToDiscord } from './discord-client'
import type { Notice } from './notice'
import { immediateText } from './notice-text'
import type { Notifier } from './notifier'
import { parseAlertThresholds } from './thresholds'
import { parseWebhookUrl } from './webhook-url'

/** What a test may replace: the clock, in milliseconds, and the platform's `fetch`. */
export type NotifierOptions = Readonly<{
  clock?: () => number
  send?: typeof fetch
}>

const log = (level: 'log' | 'error', line: Record<string, unknown>) =>
  console[level](JSON.stringify(line))

/**
 * Tells an alert (D-55). One raised for the next day is queued in D1 for the
 * daily mail. One raised for now goes to the Discord webhook, unless one of
 * its kind was told within the hour (D-58), or no webhook is set, in which
 * case it is recorded as not sent and logged in one line. The result never
 * rejects: a failure is logged by its kind and, for a send, its status, never
 * by the address, and the work that raised the alert goes on.
 */
export function notifierOf(env: Env, options: NotifierOptions = {}): Notifier {
  const clock = options.clock ?? Date.now
  return async (notice) => {
    try {
      await tell(env, notice, clock, options.send)
    } catch (error) {
      log('error', {
        event: 'alert_error',
        kind: notice.kind,
        name: error instanceof Error ? error.name : 'unknown',
      })
    }
  }
}

async function tell(
  env: Env,
  notice: Notice,
  clock: () => number,
  send: typeof fetch | undefined,
) {
  const now = Math.floor(clock() / 1000)
  if (notice.urgency === 'next_day') {
    await queueNextDay(env.DB, notice, now)
    return
  }
  const webhook = parseWebhookUrl(env.DISCORD_WEBHOOK_URL)
  const { throttleSeconds } = parseAlertThresholds(
    env.ALERT_THRESHOLDS ?? undefined,
  )
  const id = await claimImmediate(
    env.DB,
    notice,
    webhook ? 'sending' : 'not_configured',
    now,
    throttleSeconds,
  )
  if (id === null) {
    log('log', { event: 'alert_throttled', kind: notice.kind })
    return
  }
  if (!webhook) {
    // A secret that is set but not a Discord webhook is said apart from one
    // that is missing; neither value is printed.
    log('log', {
      event: 'alert_not_sent',
      kind: notice.kind,
      reason: env.DISCORD_WEBHOOK_URL ? 'webhook_invalid' : 'webhook_unset',
    })
    return
  }
  const text = immediateText(notice, env.OPERATOR_ORIGIN)
  if (text === null) {
    await finishImmediate(env.DB, id, 'failed')
    log('error', { event: 'alert_refused', kind: notice.kind })
    return
  }
  const result = await postToDiscord(webhook, text, send)
  await finishImmediate(env.DB, id, result.kind === 'sent' ? 'sent' : 'failed')
  if (result.kind === 'refused')
    log('error', {
      event: 'alert_send_failed',
      kind: notice.kind,
      status: result.status,
    })
  else if (result.kind === 'failed')
    log('error', {
      event: 'alert_send_failed',
      kind: notice.kind,
      reason: result.reason,
    })
}
