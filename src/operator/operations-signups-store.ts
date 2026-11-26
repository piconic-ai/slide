import { readSignupCounts } from '../auth/signup-count-store'
import { signupModeOf } from '../auth/signup-mode'
import { readSignupPause } from '../auth/signup-pause-store'
import type { SignupsFrameView } from './operations-signups-frame'

/**
 * What the "新しい登録" frame shows: the mode the setting means, whether new
 * sign-ups are stopped, and the counts of people who registered lately.
 */
export async function readSignupsFrame(env: Env): Promise<SignupsFrameView> {
  const now = Math.floor(Date.now() / 1000)
  const [pause, counts] = await Promise.all([
    readSignupPause(env.DB),
    readSignupCounts(env.DB, now),
  ])
  return {
    kind: 'ready',
    mode: signupModeOf(env.OPEN_SIGNUP),
    pausedSince: pause.kind === 'paused' ? pause.since : null,
    lastHour: counts.lastHour,
    lastDay: counts.lastDay,
  }
}
