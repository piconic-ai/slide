import { describe, expect, test } from 'vitest'
import {
  headingOf,
  siteNameOf,
  sourceLinkTextOf,
  sourceOf,
} from './link-heading'

const KANAGAWA = {
  service: 'connpass',
  ref: '410635',
  host: 'connpass.com',
  url: 'https://connpass.com/event/410635/',
} as const

describe('headingOf', () => {
  test.each([
    [KANAGAWA, 'connpass https://connpass.com/event/410635/'],
    [
      {
        service: 'doorkeeper',
        ref: '12',
        host: 'a.doorkeeper.jp',
        url: 'https://a.doorkeeper.jp/events/12',
      },
      'Doorkeeper https://a.doorkeeper.jp/events/12',
    ],
    [
      {
        service: 'luma',
        ref: 'abcd1234',
        host: 'luma.com',
        url: 'https://luma.com/abcd1234',
      },
      'Luma https://luma.com/abcd1234',
    ],
    [
      {
        service: 'web',
        ref: 'peatix.com/event/1',
        host: 'peatix.com',
        url: 'https://peatix.com/event/1',
      },
      'peatix.com https://peatix.com/event/1',
    ],
  ] as const)(
    'F45-AC10: Given %o with no name and no title on a public slide, When its heading is made, Then it is the site and the address',
    (link, heading) => {
      expect(headingOf({ ...link, name: null, firstTitle: null })).toBe(heading)
    },
  )

  test.each(['Kanagawa.pm #3', '<b>x</b>', '🎉 Night', ' '])(
    'F45-AC10: Given no name and the first title %j, When the heading is made, Then it is that title as it is',
    (firstTitle) => {
      expect(headingOf({ ...KANAGAWA, name: null, firstTitle })).toBe(
        firstTitle,
      )
    },
  )

  test('F45-AC11: Given a name kept for the event and another first title, When the heading is made, Then it is the name', () => {
    expect(
      headingOf({ ...KANAGAWA, name: 'Fixed name', firstTitle: 'A title' }),
    ).toBe('Fixed name')
    expect(headingOf({ ...KANAGAWA, name: 'Old', firstTitle: null })).toBe(
      'Old',
    )
  })
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
      { service: 'web', host: 'example.com' },
      'example.com で見る',
      'View on example.com',
    ],
  ] as const)(
    'F45-AC16: Given a link on %o, When the way to its own page is written, Then it names the site',
    (link, ja, en) => {
      expect(sourceLinkTextOf(link, 'ja')).toBe(ja)
      expect(sourceLinkTextOf(link, 'en')).toBe(en)
      expect(siteNameOf(link)).toBe(ja.replace(' で見る', ''))
    },
  )
})

describe('sourceOf', () => {
  const event = (firstLinkHost: string | null) =>
    ({ kind: 'event', event: KANAGAWA, firstLinkHost }) as const

  test.each([
    [
      'kanagawapm.connpass.com',
      'https://kanagawapm.connpass.com/event/410635/',
    ],
    ['connpass.com', KANAGAWA.url],
    [null, KANAGAWA.url],
    // A host that is no group of connpass names no group.
    ['evilconnpass.com', KANAGAWA.url],
  ])(
    'F45-AC25: Given a connpass event whose oldest link was written with %j, When its way out is made, Then it is %s',
    (host, url) => {
      expect(sourceOf(event(host))).toBe(url)
    },
  )

  test('F45-AC25: Given an event elsewhere, When its way out is made, Then it is its own address, whatever host its link had', () => {
    const luma = {
      service: 'luma',
      ref: 'abc',
      url: 'https://luma.com/abc',
    } as const
    expect(
      sourceOf({ kind: 'event', event: luma, firstLinkHost: 'lu.ma' }),
    ).toBe(luma.url)
  })

  test('F45-AC25: Given a link that is no event, When its way out is made, Then it is where its oldest link leads', () => {
    expect(
      sourceOf({ kind: 'link', firstLinkUrl: 'https://example.com/a?b=1' }),
    ).toBe('https://example.com/a?b=1')
  })
})
