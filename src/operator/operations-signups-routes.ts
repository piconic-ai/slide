import type { Hono, MiddlewareHandler } from 'hono'
import { setSignupPause } from '../auth/signup-pause-store'
import type { OperatorEnv } from './operator-env'

/**
 * `POST /operations/signups/pause` and `.../resume`: one press of "新しい登録を
 * 止める" or "再開する". Like every change an operator makes, the form comes
 * from this origin only (`sameOrigin`), and the operator is the one Cloudflare Access
 * verified, who is kept with the press. The log line holds what changed and
 * nothing of who.
 */
export function mountSignupsPause(
  app: Hono<OperatorEnv>,
  sameOrigin: MiddlewareHandler<OperatorEnv>,
) {
  for (const [path, paused] of [
    ['/operations/signups/pause', true],
    ['/operations/signups/resume', false],
  ] as const)
    app.post(path, sameOrigin, async (c) => {
      const result = await setSignupPause(c.env.DB, {
        paused,
        by: c.get('operator').email,
        now: Math.floor(Date.now() / 1000),
      })
      console.log(
        JSON.stringify({
          event: paused ? 'signup_paused' : 'signup_resumed',
          result,
        }),
      )
      return c.redirect('/operations#signups', 303)
    })
}
