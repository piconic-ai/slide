import { messages, type Lang } from '../site/i18n'
import type { Deployment } from '../db/schema'

/** How many unreceived paths one history entry lists. */
export const MISSING_PATHS_SHOWN = 20

export type FileProgress = Readonly<{
  total: number
  received: number
  /** Unreceived paths, sorted, at most MISSING_PATHS_SHOWN of them. */
  missing: readonly string[]
}>

export type HistoryState = Deployment['state']

export type HistoryEntry = Readonly<{
  deploymentId: string
  commit: string
  ref: string
  runId: string
  runAttempt: string
  state: HistoryState
  createdAt: number
  readyAt: number | null
  failureReason: string | null
  totalBytes: number
  files: Readonly<{
    total: number
    received: number
    missing: readonly string[]
    missingNotShown: number
  }>
}>

/**
 * An uploading session past its expiry is shown as expired even before the
 * cleanup job records it, so history never shows a dead session as active.
 */
export function historyState(
  row: Pick<Deployment, 'state' | 'expires_at'>,
  now: number,
): HistoryState {
  return row.state === 'uploading' && row.expires_at <= now
    ? 'expired'
    : row.state
}

export function historyEntry(
  row: Deployment,
  progress: FileProgress,
  now: number,
): HistoryEntry {
  const state = historyState(row, now)
  // Missing files only explain sessions that did not finish receiving.
  const unfinished = state === 'uploading' || state === 'expired'
  const missing = unfinished
    ? progress.missing.slice(0, MISSING_PATHS_SHOWN)
    : []
  const missingCount = unfinished ? progress.total - progress.received : 0
  return {
    deploymentId: row.id,
    commit: row.source_sha,
    ref: row.source_ref,
    runId: row.run_id,
    runAttempt: row.run_attempt,
    state,
    createdAt: row.created_at,
    readyAt: row.ready_at,
    failureReason: row.failure_reason,
    totalBytes: row.total_bytes,
    files: {
      total: progress.total,
      received: progress.received,
      missing,
      missingNotShown: Math.max(0, missingCount - missing.length),
    },
  }
}

const labels = messages({
  ja: {
    states: {
      uploading: '受信中',
      ready: '受領完了',
      failed: '失敗',
      expired: '期限切れ',
    } satisfies Record<HistoryState, string>,
    reasons: {
      too_many_files: 'ファイル数が一版の上限を超えています',
      file_too_large: '一ファイルの上限を超えるファイルがあります',
      deployment_too_large: '一版の合計サイズが上限を超えています',
      author_bytes_exceeded: '保存できる合計サイズの上限を超えています',
      daily_starts_exceeded: '24時間のアップロード開始回数の上限に達しました',
    },
  },
  en: {
    states: {
      uploading: 'Receiving',
      ready: 'Received',
      failed: 'Failed',
      expired: 'Expired',
    },
    reasons: {
      too_many_files: 'More files than one version may have',
      file_too_large: 'A file is larger than one file may be',
      deployment_too_large: 'The version is larger in total than allowed',
      author_bytes_exceeded: 'Your stored files exceed the total allowed',
      daily_starts_exceeded: 'Reached the limit of uploads started in 24 hours',
    },
  },
})

export function stateLabel(state: HistoryState, lang: Lang): string {
  return labels[lang].states[state]
}

/** A failure reason in words; a reason this version does not know shows as is. */
export function reasonLabel(reason: string, lang: Lang): string {
  const { reasons } = labels[lang]
  return Object.hasOwn(reasons, reason)
    ? reasons[reason as keyof typeof reasons]
    : reason
}

/** Position after which the next history page starts. */
export type HistoryCursor = Readonly<{ createdAt: number; id: string }>

export function formatCursor(cursor: HistoryCursor): string {
  return `${cursor.createdAt}.${cursor.id}`
}

export function parseCursor(value: string): HistoryCursor | null {
  const match = /^(\d{1,15})\.([A-Za-z0-9-]{1,64})$/.exec(value)
  return match ? { createdAt: Number(match[1]), id: match[2] as string } : null
}
