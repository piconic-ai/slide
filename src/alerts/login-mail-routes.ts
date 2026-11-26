import { loginMailNotice } from './counted-notices'
import { countSignals, recordSignal } from './signal-store'
import { notifierOf } from './notify-routes'
import type { Notifier } from './notifier'
import { parseAlertThresholds } from './thresholds'

/** The kind a failure to send login mail is counted under. */
export const LOGIN_MAIL_SIGNAL = 'login_mail_failed'

/**
 * A login code could not be sent (F39-AC1): the failure is noted, and when
 * enough have fallen within the window an alert goes out at once. The alert
 * is once an hour a kind however many failures follow (F39-AC2), which the
 * notifier sees to. It never rejects and keeps nothing of the address.
 */
export async function reportLoginMailFailure(
  env: Env,
  options: Readonly<{ clock?: () => number; notify?: Notifier }> = {},
): Promise<void> {
  try {
    const now = Math.floor((options.clock ?? Date.now)() / 1000)
    const thresholds = parseAlertThresholds(env.ALERT_THRESHOLDS)
    await recordSignal(env.DB, LOGIN_MAIL_SIGNAL, now)
    const failures = await countSignals(
      env.DB,
      LOGIN_MAIL_SIGNAL,
      now - thresholds.loginMailWindowSeconds,
    )
    const notice = loginMailNotice(failures, thresholds)
    if (notice)
      await (options.notify ?? notifierOf(env, { clock: options.clock }))(
        notice,
      )
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'alert_error',
        kind: LOGIN_MAIL_SIGNAL,
        name: error instanceof Error ? error.name : 'unknown',
      }),
    )
  }
}
