import type { Hono } from 'hono'
import type { OperatorEnv } from './operator-env'
import type { BackupsFrameView } from './operations-backups-frame'
import type { EmailFrameView } from './operations-email-frame'
import type { MaintenanceFrameView } from './operations-maintenance-frame'
import type { SignupsFrameView } from './operations-signups-frame'
import { readAlertsFrame } from '../alerts/alerts-frame-routes'
import { operationsPage } from './operations-pages'
import { readFrames } from './operator-frames'

/**
 * The readers of the operations page's frames. The work behind a frame
 * replaces its own reader, and no other line of this table: it reads from D1
 * and the environment, and answers the view its frame draws.
 */
export const operationsReaders = {
  // Work N: the notice schedule.
  maintenance: async (_env: Env): Promise<MaintenanceFrameView> => ({
    kind: 'pending',
  }),

  // Work R: new sign-ups.
  signups: async (_env: Env): Promise<SignupsFrameView> => ({
    kind: 'pending',
  }),

  // Work C: the encryption of email addresses.
  email: async (_env: Env): Promise<EmailFrameView> => ({ kind: 'pending' }),

  // Work B: the backups.
  backups: async (_env: Env): Promise<BackupsFrameView> => ({
    kind: 'pending',
  }),

  // Work M: the alerts.
  alerts: readAlertsFrame,
}

/** `GET /operations`, on the operator host only. */
export function mountOperations(app: Hono<OperatorEnv>, policy: string) {
  app.get('/operations', async (c) =>
    c.html(
      operationsPage({
        operator: c.get('operator'),
        ...(await readFrames(operationsReaders, c.env)),
      }),
      200,
      { 'Content-Security-Policy': policy },
    ),
  )
}
