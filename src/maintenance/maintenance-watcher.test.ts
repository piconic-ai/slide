import { expect, test } from 'vitest'
import { MAINTENANCE_HEADER as WATCHED } from '../../watcher/src/observe'
import { MAINTENANCE_HEADER as SENT } from './switch'

test('F38-AC23: Given the header the service sends and the one the watcher looks for, When compared, Then they are the same header', () => {
  expect(WATCHED.toLowerCase()).toBe(SENT.toLowerCase())
})

test('F38-AC23: Given a maintenance answer of the service, When the watcher reads its headers, Then it takes the answer for maintenance and not for a fault', async () => {
  const { isMaintenanceAnswer } = await import('../../watcher/src/observe')
  const { maintenanceHeaders } = await import('./switch')
  const headers = new Headers(
    maintenanceHeaders({ kind: 'on', until: null, reason: null }, 0),
  )
  expect(isMaintenanceAnswer(503, headers)).toBe(true)
  // A 503 that is a fault has no mark, and a mark on another status is none.
  expect(
    isMaintenanceAnswer(503, new Headers({ 'X-Slide-Intended': 'x' })),
  ).toBe(false)
  expect(isMaintenanceAnswer(200, headers)).toBe(false)
})
