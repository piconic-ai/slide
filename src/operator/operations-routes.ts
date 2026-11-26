import type { Context, Hono, MiddlewareHandler } from 'hono'
import type { OperatorEnv } from './operator-env'
import { readAlertsFrame } from '../alerts/alerts-frame-routes'
import { readBackupsFrame } from '../backups/backup-routes'
import { mountNotice, readMaintenanceFrame } from '../maintenance/notice-routes'
import { parseNoticeResult } from './operations-maintenance-frame'
import { operationsPage, type OperationsView } from './operations-pages'
import { mountEmailRewrite } from './operations-email-routes'
import { readEmailFrame } from './operations-email-store'
import { mountSignupsPause } from './operations-signups-routes'
import { readSignupsFrame } from './operations-signups-store'
import { readFrames } from './operator-frames'

/**
 * The readers of the operations page's frames. The work behind a frame
 * replaces its own reader, and no other line of this table: it reads from D1
 * and the environment, and answers the view its frame draws.
 */
export const operationsReaders = {
  // Work N: the notice schedule.
  maintenance: readMaintenanceFrame,

  // Work R: new sign-ups.
  signups: readSignupsFrame,

  // Work C: the encryption of email addresses.
  email: readEmailFrame,

  // Work B: the backups.
  backups: readBackupsFrame,

  // Work M: the alerts.
  alerts: readAlertsFrame,
}

type FrameViews = Awaited<
  ReturnType<typeof readFrames<typeof operationsReaders>>
>

/**
 * The operations page and the forms of its frames, on the operator host only.
 * `sameOrigin` is the check that a form comes from this origin; it guards
 * every form posted from the page.
 */
export function mountOperations(
  app: Hono<OperatorEnv>,
  policy: string,
  sameOrigin: MiddlewareHandler<OperatorEnv>,
) {
  mountEmailRewrite(app)
  mountSignupsPause(app, sameOrigin)
  /** `change` replaces the views of some frames, given what each reader read. */
  const page = async (
    c: Context<OperatorEnv>,
    change: (frames: FrameViews) => Partial<OperationsView> = () => ({}),
    status: 200 | 400 = 200,
  ) => {
    const frames = await readFrames(operationsReaders, c.env)
    return c.html(
      operationsPage({
        operator: c.get('operator'),
        ...frames,
        ...change(frames),
      }),
      status,
      { 'Content-Security-Policy': policy },
    )
  }

  app.get('/operations', (c) => {
    const result = parseNoticeResult(c.req.query('maintenance'))
    return page(c, (frames) =>
      result === null ? {} : { maintenance: { ...frames.maintenance, result } },
    )
  })

  mountNotice(app, sameOrigin, (c, maintenance, status) =>
    page(c, () => ({ maintenance }), status),
  )
}
