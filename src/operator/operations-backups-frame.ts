import { html } from 'hono/html'
import { notConfigured } from './not-configured'
import { operatorFrame } from './operator-frame'
import { timeTag } from './operator-time'

/** Where the steps to create the backup bucket and add its binding are (D-08, F39-AC30). */
export const BACKUP_STEPS = 'docs/dev/deploy.md#r2-をバックアップから戻す'

/**
 * What the frame shows: that the backup bucket is not set up (D-08), or the
 * state of the copy (D-70). Times are in seconds.
 */
export type BackupsFrameView =
  | Readonly<{ kind: 'not_configured' }>
  | Readonly<{
      kind: 'ready'
      /** When something was last copied, or null if nothing has been. */
      lastCopiedAt: number | null
      /** How many files were copied since the latest pass started. */
      copiedInLastPass: number
      /** Files in the backup whose source is there. */
      kept: number
      /** Files in the backup whose source is gone, kept for their 30 days. */
      keptAfterDeletion: number
      passInProgress: boolean
      lastCompletedAt: number | null
      lastRunAt: number | null
      /** When a run last had a failure, or null if none has. */
      lastFailedAt: number | null
      /** How many failures the latest run had. */
      lastRunFailed: number
    }>

const time = (seconds: number | null) => timeTag(seconds)

type Ready = Extract<BackupsFrameView, { kind: 'ready' }>

const failure = (view: Ready) => {
  if (view.lastFailedAt === null) return html`ありません`
  return view.lastRunFailed > 0
    ? html`直近の実行で ${view.lastRunFailed} 件(${time(view.lastFailedAt)})`
    : html`直近の実行は成功(最後の失敗は ${time(view.lastFailedAt)})`
}

const rows = (view: Ready) => [
  ['最後に写した日時', time(view.lastCopiedAt)],
  ['最後の巡回で写した数', html`${view.copiedInLastPass} 件`],
  [
    '巡回',
    view.passInProgress
      ? html`途中です(次の実行で続きから進みます)`
      : html`最後に終えたのは ${time(view.lastCompletedAt)}`,
  ],
  ['最後の実行', time(view.lastRunAt)],
  ['失敗', failure(view)],
  ['バックアップにあるファイル', html`${view.kept} 件`],
  [
    '元から消えて保管中のファイル',
    html`${view.keptAfterDeletion} 件(消えたと分かってから 30 日で消えます)`,
  ],
]

/** The frame "バックアップ" of the operations page (02-PAGES 16.4). */
export const backupsFrame = (view: BackupsFrameView): ReturnType<typeof html> =>
  operatorFrame(
    { id: 'backups', heading: 'バックアップ' },
    view.kind === 'not_configured'
      ? notConfigured(['UPLOADS_BACKUP'], BACKUP_STEPS)
      : html`<div class="table-scroll">
          <table class="data-table" aria-label="バックアップの状態">
            <tbody>
              ${rows(view).map(
                ([label, value]) =>
                  html`<tr>
                    <th scope="row">${label}</th>
                    <td><span class="cell-label">${label}</span>${value}</td>
                  </tr>`,
              )}
            </tbody>
          </table>
        </div>`,
  )
