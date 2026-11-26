import type { AlertsFrameView } from '../operator/operations-alerts-frame'
import { listRecent } from './alert-store'
import { shownState } from './notice-text'
import { parseWebhookUrl } from './webhook-url'

/** How many alerts the operations page lists. */
export const RECENT_ALERTS = 20

/**
 * What the frame "通知" of the operations page shows: whether the webhook
 * secret is a usable one, and the newest alerts. The secret itself is never
 * read into the view, only whether it is one.
 */
export async function readAlertsFrame(env: Env): Promise<AlertsFrameView> {
  const recent = await listRecent(env.DB, RECENT_ALERTS)
  const now = Math.floor(Date.now() / 1000)
  return {
    kind: parseWebhookUrl(env.DISCORD_WEBHOOK_URL) ? 'ready' : 'not_configured',
    // A message left on its way for good is shown as failed.
    recent: recent.map(({ kind, count, phase, raisedAt, state }) => ({
      kind,
      count,
      phase,
      raisedAt,
      state: shownState(state, raisedAt, now),
    })),
  }
}
