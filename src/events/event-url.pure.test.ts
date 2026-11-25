import { describe, expect, test } from 'vitest'
import { eventRefOf, isEventAddress, LUMA_SITE_PATHS } from './event-url'

describe('isEventAddress', () => {
  test.each([
    'https://kanagawapm.connpass.com/event/410635/',
    'https://kanagawapm.connpass.com/event/410635',
    'https://connpass.com/event/410635/',
    'https://KanagawaPM.Connpass.com/event/410635/?utm_source=x#top',
  ])(
    'F29-AC1: Given the connpass event address %s, When it is read, Then it is an event',
    (address) => {
      expect(isEventAddress(address)).toBe(true)
    },
  )

  test.each([
    'https://rubykaigi.doorkeeper.jp/events/12345',
    'https://rubykaigi.doorkeeper.jp/events/12345/',
    'https://RubyKaigi.doorkeeper.jp/events/12345?x=1',
  ])(
    'F29-AC2: Given the Doorkeeper event address %s, When it is read, Then it is an event',
    (address) => {
      expect(isEventAddress(address)).toBe(true)
    },
  )

  test.each([
    'https://luma.com/abcd1234',
    'https://lu.ma/abcd1234',
    'https://lu.ma/abcd1234/',
    'https://luma.com/hono-night_5?tk=x',
  ])(
    'F29-AC3: Given the Luma event address %s, When it is read, Then it is an event',
    (address) => {
      expect(isEventAddress(address)).toBe(true)
    },
  )

  test.each([
    ...['discover', 'calendar', 'user', 'signin', 'Discover', 'SIGNIN'].map(
      (word) => `https://luma.com/${word}`,
    ),
    'https://lu.ma/calendar/',
    'https://luma.com/',
    'https://luma.com/user/kfly8',
    'https://luma.com/a/b',
    'https://notluma.com/abcd1234',
    'https://luma.com.example/abcd1234',
  ])(
    'F29-AC3: Given the Luma site address %s, When it is read, Then it is not an event',
    (address) => {
      expect(isEventAddress(address)).toBe(false)
    },
  )

  test.each([
    // Not an event page of the group.
    'https://kanagawapm.connpass.com/',
    'https://kanagawapm.connpass.com/event/',
    'https://kanagawapm.connpass.com/event/abc/',
    'https://kanagawapm.connpass.com/event/410635/participation/',
    'https://connpass.com/explore/',
    // Doorkeeper without a group, or not an event.
    'https://doorkeeper.jp/events/12345',
    'https://rubykaigi.doorkeeper.jp/',
    'https://rubykaigi.doorkeeper.jp/events/upcoming',
    // Look-alike hosts: matched on the parsed host, never on the text.
    'https://connpass.com.example/event/1/',
    'https://evilconnpass.com/event/1/',
    'https://a.b.connpass.com/event/1/',
    'https://example.com/https://connpass.com/event/1/',
    'https://example.com/?u=https://connpass.com/event/1/',
    'https://xn--connpss-7ya.com/event/1/',
    // Not addresses at all.
    '',
    'connpass.com/event/1/',
    'javascript:alert(1)//connpass.com/event/1/',
    'ftp://connpass.com/event/1/',
  ])(
    'F29-AC1: Given the address %s, When it is read, Then it is not an event',
    (address) => {
      expect(isEventAddress(address)).toBe(false)
    },
  )

  test('F29-AC3: Given the words of Luma pages, When they are listed, Then the ones the spec names are there', () => {
    for (const word of ['discover', 'calendar', 'user', 'signin'])
      expect(LUMA_SITE_PATHS.has(word)).toBe(true)
  })
})

describe('eventRefOf', () => {
  const keyOf = (address: string) => eventRefOf(address)?.key

  test.each([
    [
      'https://kanagawapm.connpass.com/event/410635/',
      'https://kanagawapm.connpass.com/event/410635',
      'https://kanagawapm.connpass.com/event/410635/?utm_source=x',
      'https://kanagawapm.connpass.com/event/410635/#talks',
      'https://KANAGAWAPM.CONNPASS.COM/event/410635/',
      'http://kanagawapm.connpass.com/event/410635/',
      'https://kanagawapm.connpass.com./event/410635/',
    ],
    [
      'https://luma.com/abcd1234',
      'https://lu.ma/abcd1234',
      'https://LU.MA/abcd1234/',
      'http://lu.ma/abcd1234?tk=1#x',
      'https://Luma.com/abcd1234/',
    ],
    [
      'https://rubykaigi.doorkeeper.jp/events/12345',
      'https://rubykaigi.doorkeeper.jp/events/12345/',
      'https://RubyKaigi.Doorkeeper.jp/events/12345?a=b#c',
      'http://rubykaigi.doorkeeper.jp/events/12345',
    ],
    [
      'https://peatix.com/event/123/view',
      'https://peatix.com/event/123/view/',
      'https://PEATIX.com/event/123/view?lang=ja',
      'http://peatix.com/event/123/view#x',
    ],
  ])(
    'F29-AC6: Given the addresses of one event written in several ways (%s, ...), When their keys are read, Then they are one key',
    (...addresses) => {
      const keys = new Set(addresses.map(keyOf))
      expect(keys.size).toBe(1)
      expect([...keys][0]).toMatch(/^https:\/\/[^?#]*[^/?#]$/u)
    },
  )

  test('F29-AC7: Given connpass addresses of one event number under different groups and none, When their keys are read, Then they are one key', () => {
    const keys = [
      'https://kanagawapm.connpass.com/event/410635/',
      'https://yokohamapm.connpass.com/event/410635/',
      'https://connpass.com/event/410635/',
    ].map(keyOf)
    expect(new Set(keys)).toEqual(
      new Set(['https://connpass.com/event/410635']),
    )
  })

  test('F29-AC7: Given connpass addresses of two event numbers under one group, When their keys are read, Then they differ', () => {
    expect(keyOf('https://kanagawapm.connpass.com/event/410635/')).not.toBe(
      keyOf('https://kanagawapm.connpass.com/event/410636/'),
    )
  })

  test('F29-AC6: Given Doorkeeper addresses of one number under two groups, When their keys are read, Then they differ (only connpass ignores the group)', () => {
    expect(keyOf('https://a.doorkeeper.jp/events/1')).not.toBe(
      keyOf('https://b.doorkeeper.jp/events/1'),
    )
  })

  test.each([
    [
      'https://KanagawaPM.connpass.com/event/410635/?x=1',
      {
        key: 'https://connpass.com/event/410635',
        service: 'connpass',
        ref: '410635',
        host: 'kanagawapm.connpass.com',
        url: 'https://kanagawapm.connpass.com/event/410635/',
      },
    ],
    [
      'https://connpass.com/event/7/',
      {
        key: 'https://connpass.com/event/7',
        service: 'connpass',
        ref: '7',
        host: 'connpass.com',
        url: 'https://connpass.com/event/7/',
      },
    ],
    [
      'https://rubykaigi.doorkeeper.jp/events/12345#x',
      {
        key: 'https://rubykaigi.doorkeeper.jp/events/12345',
        service: 'doorkeeper',
        ref: '12345',
        host: 'rubykaigi.doorkeeper.jp',
        url: 'https://rubykaigi.doorkeeper.jp/events/12345',
      },
    ],
    [
      'https://lu.ma/abcd1234?tk=1',
      {
        key: 'https://luma.com/abcd1234',
        service: 'luma',
        ref: 'abcd1234',
        host: 'luma.com',
        url: 'https://luma.com/abcd1234',
      },
    ],
    [
      'https://lu.ma/calendar',
      {
        key: 'https://luma.com/calendar',
        service: 'web',
        ref: 'luma.com/calendar',
        host: 'luma.com',
        url: 'https://luma.com/calendar',
      },
    ],
    [
      'https://Example.com/',
      {
        key: 'https://example.com',
        service: 'web',
        ref: 'example.com',
        host: 'example.com',
        url: 'https://example.com/',
      },
    ],
    [
      'https://example.com:8443/meetup/1//?q#f',
      {
        key: 'https://example.com:8443/meetup/1',
        service: 'web',
        ref: 'example.com:8443/meetup/1',
        host: 'example.com:8443',
        url: 'https://example.com:8443/meetup/1//',
      },
    ],
  ])(
    'F29-AC4: Given the address %s made an event by its author, When its event is read, Then it is %o',
    (address, expected) => {
      expect(eventRefOf(address)).toEqual(expected)
    },
  )

  test('F29-AC6: Given a path whose case differs, When the keys are read, Then they differ (only the host is folded)', () => {
    expect(keyOf('https://example.com/Meetup')).not.toBe(
      keyOf('https://example.com/meetup'),
    )
  })

  test.each([
    '',
    'not a url',
    'javascript:alert(1)',
    'data:text/html,x',
    'ftp://connpass.com/event/1/',
    'mailto:a@example.com',
  ])(
    'F29-AC4: Given %j, which is not an http(s) address, When its event is read, Then there is none',
    (address) => {
      expect(eventRefOf(address)).toBeNull()
    },
  )

  test('F29-AC6: Given a script in the path, When the key is read, Then it stays encoded in the key', () => {
    const ref = eventRefOf('https://example.com/<script>alert(1)</script>')
    expect(ref?.key).not.toContain('<')
  })
})
