import { expect, test } from 'vitest'
import {
  BACKUP_STEPS,
  backupsFrame,
  type BackupsFrameView,
} from './operations-backups-frame'

type Ready = Extract<BackupsFrameView, { kind: 'ready' }>
const AT = Date.UTC(2026, 10, 26, 18, 20, 9) / 1000
const ready = (changes: Partial<Ready> = {}): Ready => ({
  kind: 'ready',
  lastCopiedAt: AT,
  copiedInLastPass: 12,
  kept: 340,
  keptAfterDeletion: 2,
  passInProgress: false,
  lastCompletedAt: AT + 60,
  lastRunAt: AT + 60,
  lastFailedAt: null,
  lastRunFailed: 0,
  ...changes,
})
const drawn = (view: BackupsFrameView) => String(backupsFrame(view))

test('F39-AC30: Given no backup bucket, When the frame is drawn, Then it says 未設定, what to set and where the steps are, under its heading', () => {
  const page = drawn({ kind: 'not_configured' })
  expect(page).toMatch(/<h2>バックアップ<\/h2>\s*<p class="not-configured"/)
  expect(page).toContain('未設定')
  expect(page).toContain('<code>UPLOADS_BACKUP</code>')
  expect(page).toContain(`<code>${BACKUP_STEPS}</code>`)
  expect(page).not.toContain('<table')
  expect(page).not.toContain('準備中')
})

test('F39-AC32: Given a backup that works, When the frame is drawn, Then it shows when it last copied, how many, and that there is no failure', () => {
  const page = drawn(ready())
  expect(page).toContain('最後に写した日時')
  expect(page).toContain('2026-11-26T18:20:09.000Z')
  expect(page).toContain('12 件')
  expect(page).toContain('<th scope="row">失敗</th>')
  expect(page).toMatch(/失敗<\/span>ありません<\/td>/)
  expect(page).toContain('340 件')
  expect(page).toContain('2 件(消えたと分かってから 30 日で消えます)')
  expect(page).not.toContain('未設定')
})

test('F39-AC32: Given a backup that has never copied, When the frame is drawn, Then the times say there is none yet', () => {
  const page = drawn(
    ready({
      lastCopiedAt: null,
      lastCompletedAt: null,
      lastRunAt: null,
      copiedInLastPass: 0,
      kept: 0,
      keptAfterDeletion: 0,
    }),
  )
  expect(page.match(/まだありません/g)).toHaveLength(3)
  expect(page).not.toContain('<time')
})

test('F39-AC32: Given a latest run that failed, When the frame is drawn, Then it shows how many failed and when', () => {
  const page = drawn(ready({ lastFailedAt: AT, lastRunFailed: 4 }))
  expect(page).toContain('直近の実行で 4 件')
  expect(page).toContain('2026-11-26T18:20:09.000Z')
})

test('F39-AC32: Given a failure followed by a run that worked, When the frame is drawn, Then it says the latest run succeeded and when the last failure was', () => {
  const page = drawn(ready({ lastFailedAt: AT - 86400, lastRunFailed: 0 }))
  expect(page).toContain('直近の実行は成功')
  expect(page).toContain('2026-11-25T18:20:09.000Z')
})

test('F39-AC29: Given a pass in progress, When the frame is drawn, Then it says the next run goes on', () => {
  expect(drawn(ready({ passInProgress: true }))).toContain(
    '途中です(次の実行で続きから進みます)',
  )
})
