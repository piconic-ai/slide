import { expect, test } from 'vitest'
import {
  COMMUNITY_NOTICE_WINDOW_SECONDS,
  noticeWindowStart,
  READ_RETENTION_SECONDS,
  retentionCutoffs,
  UNREAD_RETENTION_SECONDS,
} from './limits'

test('Given the agreed periods, When the constants are read, Then they are 7, 30 and 90 days', () => {
  expect(COMMUNITY_NOTICE_WINDOW_SECONDS).toBe(7 * 86400)
  expect(READ_RETENTION_SECONDS).toBe(30 * 86400)
  expect(UNREAD_RETENTION_SECONDS).toBe(90 * 86400)
})

test('Given a time, When the cut-offs are made, Then each is the time minus its period', () => {
  expect(noticeWindowStart(1_000_000)).toBe(1_000_000 - 7 * 86400)
  expect(retentionCutoffs(10_000_000)).toEqual({
    read: 10_000_000 - 30 * 86400,
    unread: 10_000_000 - 90 * 86400,
  })
})
