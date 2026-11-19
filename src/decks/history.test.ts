import { describe, expect, test } from 'vitest'
import type { Deployment } from '../db/schema'
import {
  formatCursor,
  historyEntry,
  historyState,
  MISSING_PATHS_SHOWN,
  parseCursor,
  reasonLabel,
  sourceLabel,
} from './history'

const row = (overrides: Partial<Deployment> = {}): Deployment => ({
  id: 'd',
  idempotency_key: 'k',
  inventory_digest: 'g',
  source: 'browser',
  state: 'uploading',
  total_bytes: 3,
  token_hash: 'h',
  created_at: 10,
  expires_at: 100,
  credential_expires_at: 50,
  lease_id: null,
  lease_until: null,
  ready_at: null,
  failure_reason: null,
  swept_at: null,
  sweep_after: null,
  deck_id: 'talk',
  start_revision: null,
  publish_intent: null,
  title: null,
  description: null,
  cover_path: null,
  ...overrides,
})
const paths = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => `f${String(index).padStart(2, '0')}.js`,
  )

describe('history state', () => {
  test.each([
    [row(), 99, 'uploading'],
    [row(), 100, 'expired'],
    [row({ state: 'ready', ready_at: 20 }), 999, 'ready'],
    [row({ state: 'failed', failure_reason: 'file_too_large' }), 999, 'failed'],
  ] as const)('derives %#', (input, now, state) => {
    expect(historyState(input, now)).toBe(state)
  })
})

describe('history entry', () => {
  test('lists a bounded number of missing paths for an unfinished session', () => {
    const entry = historyEntry(
      row(),
      { total: 30, received: 5, missing: paths(MISSING_PATHS_SHOWN) },
      50,
    )
    expect(entry.files).toEqual({
      total: 30,
      received: 5,
      missing: paths(MISSING_PATHS_SHOWN),
      missingNotShown: 25 - MISSING_PATHS_SHOWN,
    })
    expect(entry).toMatchObject({ source: 'browser' })
    expect(entry).not.toHaveProperty('commit')
  })

  test('does not list missing files for ready or refused deployments', () => {
    for (const input of [
      row({ state: 'ready', ready_at: 20 }),
      row({ state: 'failed', failure_reason: 'too_many_files' }),
    ])
      expect(
        historyEntry(input, { total: 2, received: 0, missing: paths(2) }, 50)
          .files,
      ).toEqual({ total: 2, received: 0, missing: [], missingNotShown: 0 })
  })

  test('explains known reasons and keeps unknown ones visible', () => {
    expect(reasonLabel('daily_starts_exceeded', 'ja')).toMatch(/24時間/)
    expect(reasonLabel('something_new', 'ja')).toBe('something_new')
  })
})

describe('history cursor', () => {
  test('round-trips the start time and ID', () => {
    const cursor = {
      createdAt: 1793933810,
      id: 'd2b0c7c0-1111-4222-8333-944445555666',
    }
    expect(parseCursor(formatCursor(cursor))).toEqual(cursor)
  })
})

test.each([
  ['browser', 'ja', 'ブラウザ'],
  ['mcp', 'ja', 'AI エージェント'],
  ['browser', 'en', 'Browser'],
  ['mcp', 'en', 'AI agent'],
] as const)(
  'F22-AC28: Given a version sent from %s, When its source is labelled in %s, Then it reads %s',
  (source, lang, label) => {
    expect(sourceLabel(source, lang)).toBe(label)
  },
)
