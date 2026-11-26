import { html } from 'hono/html'
import {
  weekLabel,
  type Cell,
  type MetricsTable,
  type Row,
} from '../metrics/table'
import type { Operator } from './access'
import { notConfigured } from './not-configured'
import { operatorDocument } from './operator-document'
import { operatorFrame } from './operator-frame'
import { operatorNav } from './operator-nav'

/** Where the steps to set what the metrics need are (D-08, F40-AC22). */
export const METRICS_STEPS = 'docs/dev/metrics-setup.md'

/** Where the weekly table is written out as CSV. */
export const METRICS_CSV_PATH = '/metrics.csv'

/**
 * What the weekly frame shows: the table, the settings that are missing
 * (none when all are set), and the newest day copied from Analytics Engine.
 */
export type MetricsFrameView = Readonly<{
  kind: 'table'
  table: MetricsTable
  missing: readonly string[]
  lastCopy: Readonly<{ day: string; truncated: boolean }> | null
}>
export type MetricsView = Readonly<{
  operator: Operator
  weekly: MetricsFrameView
}>

const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const TENTHS = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const PERCENT = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 0,
})

/** A cell: the number, right-aligned by the table, and the share beside it. */
const cellText = (cell: Cell, unit: Row['unit']): string => {
  if (cell.value === null) return '—'
  const value = (unit === 'minutes' ? TENTHS : WHOLE).format(cell.value)
  const withUnit = unit === 'minutes' ? `${value} 分` : value
  return cell.share === null
    ? withUnit
    : `${withUnit} (${PERCENT.format(cell.share)})`
}

const rowOf = (row: Row) =>
  html`<tr>
    <th scope="row">${row.label}</th>
    ${row.cells.map((cell) => html`<td>${cellText(cell, row.unit)}</td>`)}
  </tr>`

const tableOf = (table: MetricsTable) =>
  html`<div class="table-scroll">
    <table class="metrics-table" aria-label="週ごとの数">
      <thead>
        <tr>
          <th scope="col">測るもの</th>
          ${table.weeks.map(
            (week) =>
              html`<th scope="col" title="${week.start} から">
                ${weekLabel(week)}
              </th>`,
          )}
        </tr>
      </thead>
      ${table.groups.map(
        (group) =>
          html`<tbody>
            <tr class="group-row">
              <th scope="colgroup" colspan="${table.weeks.length + 1}">
                ${group.heading}
              </th>
            </tr>
            ${group.rows.map(rowOf)}
          </tbody>`,
      )}
    </table>
  </div>`

const copyNote = (lastCopy: MetricsFrameView['lastCopy']) =>
  lastCopy === null
    ? html`<p>Analytics Engine からの集計は、まだ写していません。</p>`
    : html`<p>
        Analytics Engine から最後に写した日:
        ${lastCopy.day}${
          lastCopy.truncated ? '(行が多く、上位だけを写しました)' : ''
        }
      </p>`

const weeklyFrame = (view: MetricsFrameView): ReturnType<typeof html> => {
  const [first, ...rest] = view.missing
  return operatorFrame(
    { id: 'weekly', heading: '週ごとの数' },
    html`${first === undefined ? '' : notConfigured([first, ...rest], METRICS_STEPS)}
      <p>
        直近 12 週です。日は UTC
        で数え、週は月曜に始まります。いまの週は途中です。 Analytics Engine
        から写した数は、標本化を補った推計です。
      </p>
      ${copyNote(view.lastCopy)}
      <p>
        <a href="${METRICS_CSV_PATH}" download>CSV で書き出す</a>
      </p>
      ${tableOf(view.table)}`,
  )
}

/**
 * The metrics page (02-PAGES 15): the week table, the link to its CSV and
 * the note for a missing setting, in the one frame.
 */
export const metricsPage = (view: MetricsView) =>
  operatorDocument(
    '計測',
    html`${operatorNav('/metrics')}
      <h1>計測</h1>
      <p>${view.operator.email} として操作しています。</p>
      ${weeklyFrame(view.weekly)}`,
  )
