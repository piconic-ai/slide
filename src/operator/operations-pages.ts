import { html } from 'hono/html'
import type { Operator } from './access'
import { operatorDocument } from './operator-document'
import { operatorNav } from './operator-nav'
import { alertsFrame, type AlertsFrameView } from './operations-alerts-frame'
import { backupsFrame, type BackupsFrameView } from './operations-backups-frame'
import {
  maintenanceFrame,
  type MaintenanceFrameView,
} from './operations-maintenance-frame'
import { signupsFrame, type SignupsFrameView } from './operations-signups-frame'

/** What the operations page shows: one view for each of its four frames. */
export type OperationsView = Readonly<{
  operator: Operator
  maintenance: MaintenanceFrameView
  signups: SignupsFrameView
  backups: BackupsFrameView
  alerts: AlertsFrameView
}>

/**
 * The operations page (02-PAGES 16): the frames an operator runs the service
 * from, in this order. Each frame is drawn by a file of its own, so that the
 * work behind it changes that file alone.
 */
export const operationsPage = (view: OperationsView) =>
  operatorDocument(
    '運用',
    html`${operatorNav('/operations')}
      <h1>運用</h1>
      <p>${view.operator.email} として操作しています。</p>
      ${maintenanceFrame(view.maintenance)} ${signupsFrame(view.signups)}
      ${backupsFrame(view.backups)} ${alertsFrame(view.alerts)}`,
  )
