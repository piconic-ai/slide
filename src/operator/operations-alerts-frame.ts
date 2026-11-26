import { html } from 'hono/html'
import { alertLabel, stateLabel, type AlertState } from '../alerts/notice-text'
import { notConfigured } from './not-configured'
import { operatorFrame } from './operator-frame'

/** An alert as the operations page lists it. */
export type RecentAlert = Readonly<{
  kind: string
  count: number
  /** When it was raised, in seconds. */
  raisedAt: number
  state: AlertState
}>

/** Where the steps to set the webhook are (D-08, F39-AC11). */
export const WEBHOOK_STEPS = 'docs/dev/alerts-runbook.md#discord-webhook'

/**
 * What the frame shows: whether the Discord webhook can be used, and the
 * newest alerts. With no usable webhook the frame says so, whatever else the
 * service does (D-08).
 */
export type AlertsFrameView = Readonly<{
  kind: 'ready' | 'not_configured'
  recent: readonly RecentAlert[]
}>

const date = (seconds: number) => new Date(seconds * 1000).toISOString()

const row = (alert: RecentAlert) => {
  const label = alertLabel(alert.kind, alert.count)
  return html`<tr>
    <td>
      <span class="cell-label">日時</span
      ><time datetime="${date(alert.raisedAt)}">${date(alert.raisedAt)}</time>
    </td>
    <td><span class="cell-label">種類</span>${label.title}</td>
    <td><span class="cell-label">件数</span>${label.count}</td>
    <td><span class="cell-label">状態</span>${stateLabel(alert.state)}</td>
  </tr>`
}

const list = (recent: readonly RecentAlert[]) =>
  recent.length === 0
    ? html`<p>通知はまだありません。</p>`
    : html`<div class="table-scroll">
        <table class="data-table" aria-label="直近の通知">
          <thead>
            <tr>
              <th scope="col">日時</th>
              <th scope="col">種類</th>
              <th scope="col">件数</th>
              <th scope="col">状態</th>
            </tr>
          </thead>
          <tbody>
            ${recent.map(row)}
          </tbody>
        </table>
      </div>`

/** The frame "通知" of the operations page (02-PAGES 16.5). */
export const alertsFrame = (view: AlertsFrameView): ReturnType<typeof html> =>
  operatorFrame(
    { id: 'alerts', heading: '通知' },
    html`${
      view.kind === 'not_configured'
        ? notConfigured(['DISCORD_WEBHOOK_URL'], WEBHOOK_STEPS)
        : html`<p>すぐ知らせる通知の送り先(Discord)は、設定されています。</p>`
    }
    ${list(view.recent)}`,
  )
