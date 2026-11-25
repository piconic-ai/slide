import { describe, expect, test } from 'vitest'
import { eventNameOf, serviceNameOf, sourceLinkTextOf } from './event-name'

describe('eventNameOf', () => {
  test.each([
    [
      { service: 'connpass', ref: '410635', host: 'kanagawapm.connpass.com' },
      'connpass のイベント 410635',
      'connpass event 410635',
    ],
    [
      { service: 'doorkeeper', ref: '12', host: 'a.doorkeeper.jp' },
      'Doorkeeper のイベント 12',
      'Doorkeeper event 12',
    ],
    [
      { service: 'luma', ref: 'abcd1234', host: 'luma.com' },
      'Luma のイベント abcd1234',
      'Luma event abcd1234',
    ],
    [
      { service: 'web', ref: 'peatix.com/event/1', host: 'peatix.com' },
      'peatix.com/event/1 のイベント',
      'Event at peatix.com/event/1',
    ],
  ] as const)(
    'F29-AC9: Given an event %o whose links have no title, When its name is shown, Then it is the service and the event within it',
    (event, ja, en) => {
      expect(eventNameOf({ ...event, name: null }, 'ja')).toBe(ja)
      expect(eventNameOf({ ...event, name: null }, 'en')).toBe(en)
    },
  )

  test.each(['Kanagawa.pm #3', '<b>x</b>', '🎉 Night', ' '])(
    'F29-AC8: Given an event named %j, When its name is shown, Then it is that name as it is',
    (name) => {
      const event = {
        service: 'connpass',
        ref: '1',
        host: 'connpass.com',
        name,
      } as const
      expect(eventNameOf(event, 'ja')).toBe(name)
      expect(eventNameOf(event, 'en')).toBe(name)
    },
  )
})

describe('sourceLinkTextOf', () => {
  test.each([
    [
      { service: 'connpass', host: 'kanagawapm.connpass.com' },
      'connpass で見る',
      'View on connpass',
    ],
    [
      { service: 'doorkeeper', host: 'a.doorkeeper.jp' },
      'Doorkeeper で見る',
      'View on Doorkeeper',
    ],
    [{ service: 'luma', host: 'luma.com' }, 'Luma で見る', 'View on Luma'],
    [
      { service: 'web', host: 'peatix.com' },
      'peatix.com で見る',
      'View on peatix.com',
    ],
  ] as const)(
    'F29-AC14: Given an event on %o, When the link to its own page is written, Then it names the site',
    (event, ja, en) => {
      expect(sourceLinkTextOf(event, 'ja')).toBe(ja)
      expect(sourceLinkTextOf(event, 'en')).toBe(en)
      expect(serviceNameOf(event)).toBe(ja.replace(' で見る', ''))
    },
  )
})
