import { describe, expect, test } from 'vitest'
import {
  eventRefOf,
  groupPageOf,
  groupPageOfHosts,
  isEventAddress,
  LUMA_SITE_PATHS,
  sourceUrlOf,
} from './event-url'

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
    'https://luma.com/event/evt-nPHM1FY0GGaiJyh',
    'https://lu.ma/event/evt-nPHM1FY0GGaiJyh/?tk=1',
  ])(
    'F29-AC3: F33-AC20: Given the Luma event address %s, When it is read, Then it is an event',
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
    'https://luma.com/event',
    'https://luma.com/event/',
    'https://luma.com/event/abcd1234',
    'https://luma.com/event/evt-',
    'https://luma.com/event/evt-abc/more',
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
      'https://kanagawapm.connpass.com/event/410635//',
      'https://connpass.com/event/410635///',
      'https://kanagawapm.connpass.com/event/0410635/',
      'https://connpass.com/event/000410635',
    ],
    [
      'https://luma.com/abcd1234',
      'https://lu.ma/abcd1234',
      'https://LU.MA/abcd1234/',
      'http://lu.ma/abcd1234?tk=1#x',
      'https://Luma.com/abcd1234/',
      'https://lu.ma/abcd1234//',
    ],
    [
      'https://rubykaigi.doorkeeper.jp/events/12345',
      'https://rubykaigi.doorkeeper.jp/events/12345/',
      'https://RubyKaigi.Doorkeeper.jp/events/12345?a=b#c',
      'http://rubykaigi.doorkeeper.jp/events/12345',
      'https://rubykaigi.doorkeeper.jp/events/12345///',
      'https://rubykaigi.doorkeeper.jp/events/0012345',
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
        host: 'connpass.com',
        linkHost: 'kanagawapm.connpass.com',
        url: 'https://connpass.com/event/410635/',
      },
    ],
    [
      'https://connpass.com/event/7/',
      {
        key: 'https://connpass.com/event/7',
        service: 'connpass',
        ref: '7',
        host: 'connpass.com',
        linkHost: 'connpass.com',
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
        linkHost: 'rubykaigi.doorkeeper.jp',
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
        linkHost: 'luma.com',
        url: 'https://luma.com/abcd1234',
      },
    ],
    [
      'https://lu.ma/event/evt-nPHM1FY0GGaiJyh/?tk=1',
      {
        key: 'https://luma.com/event/evt-nPHM1FY0GGaiJyh',
        service: 'luma',
        ref: 'evt-nPHM1FY0GGaiJyh',
        host: 'luma.com',
        linkHost: 'luma.com',
        url: 'https://luma.com/event/evt-nPHM1FY0GGaiJyh',
      },
    ],
    [
      'https://lu.ma/calendar',
      {
        key: 'https://luma.com/calendar',
        service: 'web',
        ref: 'luma.com/calendar',
        host: 'luma.com',
        linkHost: 'luma.com',
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
        linkHost: 'example.com',
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
        linkHost: 'example.com:8443',
        url: 'https://example.com:8443/meetup/1/',
      },
    ],
  ])(
    'F29-AC28: Given the address %s made an event by its author, When its event is read, Then it is %o',
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
    'F29-AC28: Given %j, which is not an http(s) address, When its event is read, Then there is none',
    (address) => {
      expect(eventRefOf(address)).toBeNull()
    },
  )

  test('F29-AC6: Given a script in the path, When the key is read, Then it stays encoded in the key', () => {
    const ref = eventRefOf('https://example.com/<script>alert(1)</script>')
    expect(ref?.key).not.toContain('<')
  })
})

describe('eventRefOf, slashes and zeros', () => {
  test.each([
    [
      'https://connpass.com/event/123//',
      'connpass',
      'https://connpass.com/event/123',
    ],
    [
      'https://kanagawapm.connpass.com/event/123///',
      'connpass',
      'https://connpass.com/event/123',
    ],
    [
      'https://a.doorkeeper.jp/events/9//',
      'doorkeeper',
      'https://a.doorkeeper.jp/events/9',
    ],
    ['https://lu.ma/night//', 'luma', 'https://luma.com/night'],
  ] as const)(
    'F29-AC6: Given %s, which ends in more than one slash, When its event is read, Then it is the %s event with the key %s, not another site',
    (address, service, key) => {
      expect(eventRefOf(address)).toMatchObject({ service, key })
      expect(isEventAddress(address)).toBe(true)
    },
  )

  test.each([
    ['https://connpass.com/event/0410635/', '410635'],
    ['https://connpass.com/event/000/', '0'],
    ['https://connpass.com/event/0/', '0'],
    ['https://a.doorkeeper.jp/events/007', '7'],
  ])(
    'F29-AC7: Given the number in %s, When its event is read, Then the number is %s without leading zeros',
    (address, ref) => {
      const event = eventRefOf(address)
      expect(event?.ref).toBe(ref)
      expect(event?.key.endsWith(`/${ref}`)).toBe(true)
      expect(event?.url).not.toMatch(/\/0\d/u)
    },
  )

  test('F29-AC7: Given a number of more digits than any event, When it is read, Then it is no connpass event', () => {
    expect(
      isEventAddress(`https://connpass.com/event/${'1'.repeat(19)}/`),
    ).toBe(false)
    expect(
      isEventAddress(
        `https://connpass.com/event/${'0'.repeat(14)}${'1'.repeat(18)}/`,
      ),
    ).toBe(true)
  })

  test('F45-AC42: Given connpass addresses of one number under two groups, When their events are read, Then both lead to the page without a group and keep their own hosts', () => {
    const kanagawa = eventRefOf('https://kanagawapm.connpass.com/event/410635/')
    const evil = eventRefOf('https://evil.connpass.com/event/410635/')
    expect(kanagawa?.url).toBe('https://connpass.com/event/410635/')
    expect(evil?.url).toBe(kanagawa?.url)
    expect(evil?.host).toBe(kanagawa?.host)
    expect([kanagawa?.linkHost, evil?.linkHost]).toEqual([
      'kanagawapm.connpass.com',
      'evil.connpass.com',
    ])
  })
})

describe('groupPageOf', () => {
  test.each([
    [
      { service: 'connpass', host: 'kanagawapm.connpass.com' },
      'https://kanagawapm.connpass.com/',
    ],
    [
      { service: 'doorkeeper', host: 'rubykaigi.doorkeeper.jp' },
      'https://rubykaigi.doorkeeper.jp/',
    ],
    [{ service: 'connpass', host: 'connpass.com' }, null],
    [{ service: 'luma', host: 'luma.com' }, null],
    [{ service: 'web', host: 'kanagawapm.connpass.com' }, null],
    [{ service: 'web', host: 'example.com' }, null],
  ] as const)(
    'F45-AC27: Given an event %o, When its group page is read, Then it is %s',
    (event, page) => {
      expect(groupPageOf(event)).toBe(page)
    },
  )
})

describe('groupPageOfHosts', () => {
  test.each([
    [['kanagawapm.connpass.com'], 'https://kanagawapm.connpass.com/'],
    [
      ['kanagawapm.connpass.com', 'connpass.com'],
      'https://kanagawapm.connpass.com/',
    ],
    [['kanagawapm.connpass.com', 'evil.connpass.com'], null],
    [['connpass.com'], null],
    [[], null],
  ])(
    'F45-AC27: Given links of a connpass event written with %j, When its group is read, Then it is %s',
    (hosts, page) => {
      expect(groupPageOfHosts('connpass', hosts)).toBe(page)
    },
  )
})

describe('sourceUrlOf', () => {
  const connpass = {
    service: 'connpass',
    ref: '410635',
    url: 'https://connpass.com/event/410635/',
  } as const
  test.each([
    [
      'kanagawapm.connpass.com',
      'https://kanagawapm.connpass.com/event/410635/',
    ],
    ['connpass.com', 'https://connpass.com/event/410635/'],
    [null, 'https://connpass.com/event/410635/'],
    ['a.b.connpass.com', 'https://connpass.com/event/410635/'],
    ['-bad.connpass.com', 'https://connpass.com/event/410635/'],
    ['evilconnpass.com', 'https://connpass.com/event/410635/'],
  ])(
    'F45-AC42: Given a connpass event whose first link was written with the host %s, When its page is led to, Then it is %s',
    (host, url) => {
      expect(sourceUrlOf(connpass, host)).toBe(url)
    },
  )

  test.each([
    [
      {
        service: 'doorkeeper',
        ref: '1',
        url: 'https://rubykaigi.doorkeeper.jp/events/1',
      },
      'other.doorkeeper.jp',
    ],
    [{ service: 'luma', ref: 'abcd', url: 'https://luma.com/abcd' }, 'lu.ma'],
    [
      { service: 'web', ref: 'example.com/x', url: 'https://example.com/x' },
      'kanagawapm.connpass.com',
    ],
  ] as const)(
    'F45-AC42: Given an event of %o, When its page is led to, Then it is the event’s own address, whatever its first link’s host',
    (event, host) => {
      expect(sourceUrlOf(event, host)).toBe(event.url)
    },
  )
})
