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

test('F38-AC25: Given the messages the watcher posts and the titles the service gives the same maintenance notices, When compared, Then they say the same, and the steps are the same heading', async () => {
  const { maintenanceMessageOf } = await import('../../watcher/src/watch-text')
  const { kindTitle } = await import('../alerts/notice-text')
  const { runbookLink } = await import('../alerts/notice')
  for (const phase of ['started', 'overrun', 'ended'] as const) {
    const [title, steps] = [
      maintenanceMessageOf(phase, null).split('\n')[0],
      maintenanceMessageOf(phase, null).split('\n')[1],
    ]
    expect(title).toBe(`[slide 見張り] ${kindTitle('maintenance', phase)}`)
    expect(steps).toBe(`手順: ${runbookLink('maintenance')}`)
  }
})

test('F38-AC26: Given an end that has passed in the secret, When the service answers, Then the header still names it, so that the watcher can tell that maintenance has run on, while Retry-After is 300', async () => {
  const { maintenanceHeaders, parseSwitch } = await import('./switch')
  const { untilOf } = await import('../../watcher/src/observe')
  const sw = parseSwitch('on;until=2026-12-01T03:00:00Z')
  const after = Date.UTC(2026, 11, 1, 4, 0, 0) / 1000
  const headers = new Headers(maintenanceHeaders(sw, after))
  expect(headers.get('Retry-After')).toBe('300')
  expect(untilOf(headers)).toBe(Date.UTC(2026, 11, 1, 3, 0, 0) / 1000)
})
