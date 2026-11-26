import { mailFloodWarnAt, type LoginCodeLimits } from '../auth/login-policy'
import { noticeOf, type Notice } from './notice'
import type { AlertThresholds } from './thresholds'

/** Both alerts point to the frame of the operations page that handles them. */
export const SIGNUPS_LINK = '/operations#signups'

/**
 * The alert for login mail near or at the total cap (F42-AC8): when the codes
 * asked for within the window have reached 80% of the total, rounded up.
 * Told at once. The count is how many have been asked for, which is at most
 * the cap, since no more than that is let through.
 */
export function mailFloodNotice(
  asked: number,
  limits: LoginCodeLimits,
): Notice | null {
  return asked >= mailFloodWarnAt(limits)
    ? noticeOf('mail_flood', asked, SIGNUPS_LINK)
    : null
}

/** The hours the usual hourly number is taken over: the 7 days before the last hour. */
export const SURGE_BASELINE_HOURS = 7 * 24

/** How many people registered in the last hour, and in the 7 days before that hour. */
export type SignupCounts = Readonly<{ lastHour: number; baseline: number }>

/**
 * The alert for a surge of new sign-ups (F42-AC10, D-128): the last hour has
 * at least the minimum (10) and more than the factor (10 times) the hourly
 * average of the 7 days before it. Compared without dividing, as
 * `lastHour * 168 > factor * baseline`, so no rounding decides it. With no
 * people in the week before, the minimum alone decides. Told at once.
 */
export function signupSurgeNotice(
  counts: SignupCounts,
  thresholds: AlertThresholds,
): Notice | null {
  const { lastHour, baseline } = counts
  const surged =
    lastHour >= thresholds.signupSurgeMinimum &&
    lastHour * SURGE_BASELINE_HOURS > thresholds.signupSurgeFactor * baseline
  return surged ? noticeOf('signup_surge', lastHour, SIGNUPS_LINK) : null
}
