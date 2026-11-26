import { html } from 'hono/html'
import type { Operator } from './access'
import { operatorDocument } from './operator-document'
import { operatorFrame } from './operator-frame'
import { operatorNav } from './operator-nav'
import { pendingNote } from './not-configured'

/**
 * What the metrics page shows. Work A adds the kinds it needs: the weekly
 * table, and a missing setting drawn with `notConfigured`.
 */
export type MetricsFrameView = Readonly<{ kind: 'pending' }>
export type MetricsView = Readonly<{
  operator: Operator
  weekly: MetricsFrameView
}>

const weeklyFrame = (view: MetricsFrameView): ReturnType<typeof html> => {
  switch (view.kind) {
    case 'pending':
      return operatorFrame(
        { id: 'weekly', heading: '週ごとの数' },
        pendingNote(),
      )
  }
}

/**
 * The metrics page (02-PAGES 15). The week table, the CSV link and the note
 * for a missing setting belong in the one frame below; work A fills it.
 */
export const metricsPage = (view: MetricsView) =>
  operatorDocument(
    '計測',
    html`${operatorNav('/metrics')}
      <h1>計測</h1>
      <p>${view.operator.email} として操作しています。</p>
      ${weeklyFrame(view.weekly)}`,
  )
