import { readSignupCounts } from '../auth/signup-count-store'
import { parseLoginCodeLimits } from '../auth/login-policy'
import { countRequests } from '../auth/login-request-store'
import { mailFloodNotice, signupSurgeNotice } from './signup-notices'
import { notifierOf } from './notify-routes'
import type { Notifier } from './notifier'
import { parseAlertThresholds } from './thresholds'

type Options = Readonly<{ clock?: () => number; notify?: Notifier }>

const log = (event: string, kind: string, error: unknown) =>
  console.error(
    JSON.stringify({
      event,
      kind,
      name: error instanceof Error ? error.name : 'unknown',
    }),
  )

/**
 * Login codes have been asked for (F42-AC8): the number within the window is
 * counted, and when it has reached 80% of the total cap an alert goes out at
 * once. The notifier tells one kind once an hour however many more follow
 * (D-58). It never rejects and keeps nothing of who asked.
 */
export async function reportMailFlood(
  env: Env,
  options: Options = {},
): Promise<void> {
  try {
    const now = Math.floor((options.clock ?? Date.now)() / 1000)
    const limits = parseLoginCodeLimits(env.LOGIN_CODE_LIMITS)
    const asked = await countRequests(
      env.DB,
      'send',
      now - limits.windowSeconds,
    )
    const notice = mailFloodNotice(asked, limits)
    if (notice)
      await (options.notify ?? notifierOf(env, { clock: options.clock }))(
        notice,
      )
  } catch (error) {
    log('alert_error', 'mail_flood', error)
  }
}

/**
 * Someone has registered (F42-AC10): the last hour's sign-ups are counted
 * against the hour-by-hour average of the week before, and a surge raises an
 * alert at once. It never rejects.
 */
export async function reportSignupSurge(
  env: Env,
  options: Options = {},
): Promise<void> {
  try {
    const now = Math.floor((options.clock ?? Date.now)() / 1000)
    const counts = await readSignupCounts(env.DB, now)
    const notice = signupSurgeNotice(
      counts,
      parseAlertThresholds(env.ALERT_THRESHOLDS),
    )
    if (notice)
      await (options.notify ?? notifierOf(env, { clock: options.clock }))(
        notice,
      )
  } catch (error) {
    log('alert_error', 'signup_surge', error)
  }
}
