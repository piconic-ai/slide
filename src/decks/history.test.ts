import { describe, expect, test } from 'vitest'
import type { Deployment } from '../db/schema'
import {
  formatCursor,
  historyEntry,
  historyState,
  MISSING_PATHS_SHOWN,
  parseCursor,
  reasonLabel,
} from './history'

const row = (overrides: Partial<Deployment> = {}): Deployment => ({
  id: 'd',
  idempotency_key: 'k',
  inventory_digest: 'g',
  source_sha: 'a'.repeat(40),
  run_id: '1',
  run_attempt: '2',
  actor_id: '722500',
  repository_id: '1',
  owner_id: '2',
  source_ref: 'refs/heads/main',
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
    expect(entry).toMatchObject({ commit: 'a'.repeat(40), runAttempt: '2' })
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
    expect(reasonLabel('daily_starts_exceeded')).toMatch(/24時間/)
    expect(reasonLabel('something_new')).toBe('something_new')
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
