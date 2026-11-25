import { describe, expect, test } from 'vitest'
import {
  checkCommunityLink,
  checkCommunityLinks,
  MAX_COMMUNITY_LINKS,
  PUBLIC_HOSTS,
} from './link-rules'

describe('F30-AC11: the four kinds of link', () => {
  test.each([
    [
      'https://kanagawapm.connpass.com/',
      {
        kind: 'connpass',
        url: 'https://kanagawapm.connpass.com/',
        host: 'kanagawapm.connpass.com',
      },
    ],
    [
      'https://KanagawaPM.connpass.com',
      {
        kind: 'connpass',
        url: 'https://kanagawapm.connpass.com/',
        host: 'kanagawapm.connpass.com',
      },
    ],
    [
      'http://kanagawapm.connpass.com/?utm_source=x#top',
      {
        kind: 'connpass',
        url: 'https://kanagawapm.connpass.com/',
        host: 'kanagawapm.connpass.com',
      },
    ],
    [
      '  https://rubykaigi.doorkeeper.jp/  ',
      {
        kind: 'doorkeeper',
        url: 'https://rubykaigi.doorkeeper.jp/',
        host: 'rubykaigi.doorkeeper.jp',
      },
    ],
    [
      'https://api.lu.ma/ics/get?entity=calendar&id=cal-7iVMZ4Jm',
      {
        kind: 'luma',
        url: 'https://api.lu.ma/ics/get?entity=calendar&id=cal-7iVMZ4Jm',
        host: null,
      },
    ],
    [
      'https://api.lu.ma/ics/get?id=cal-7iVMZ4Jm&entity=calendar&utm=1',
      {
        kind: 'luma',
        url: 'https://api.lu.ma/ics/get?entity=calendar&id=cal-7iVMZ4Jm',
        host: null,
      },
    ],
    [
      'https://kanagawa.pm/',
      { kind: 'web', url: 'https://kanagawa.pm/', host: 'kanagawa.pm' },
    ],
    [
      'https://kfly8.github.io/',
      { kind: 'web', url: 'https://kfly8.github.io/', host: 'kfly8.github.io' },
    ],
    [
      'https://example.com./',
      { kind: 'web', url: 'https://example.com/', host: 'example.com' },
    ],
  ])(
    'Given %s, When it is checked, Then it is kept in its one spelling',
    (input, link) => {
      expect(checkCommunityLink(input)).toEqual({ ok: true, link })
    },
  )

  test.each([
    ['', 'invalid'],
    ['kanagawapm.connpass.com', 'invalid'],
    ['ftp://kanagawapm.connpass.com/', 'invalid'],
    ['javascript:alert(1)', 'invalid'],
    ['https://user:pass@kanagawa.pm/', 'invalid'],
    ['https://kanagawa.pm:8443/', 'invalid'],
    ['https://localhost/', 'invalid'],
    ['https://<script>.example/', 'invalid'],
    ['https://kanagawapm.connpass.com/event/410635/', 'not_top'],
    ['https://kanagawapm.connpass.com/participation/', 'not_top'],
    ['https://rubykaigi.doorkeeper.jp/events/1', 'not_top'],
    ['https://kanagawa.pm/blog/', 'not_top'],
    ['https://luma.com/kanagawa', 'luma_calendar'],
    ['https://lu.ma/calendar/cal-7iVMZ4Jm', 'luma_calendar'],
    ['https://api.lu.ma/ics/get?entity=event&id=cal-7iVMZ4Jm', 'luma_calendar'],
    ['https://api.lu.ma/ics/get?entity=calendar&id=evt-1', 'luma_calendar'],
    ['https://api.lu.ma/', 'luma_calendar'],
  ])(
    'Given %j, When it is checked, Then it is refused as %s',
    (input, reason) => {
      expect(checkCommunityLink(input)).toEqual({ ok: false, reason })
    },
  )
})

describe('F30-AC12: sites anyone uses', () => {
  test.each([
    'https://connpass.com/',
    'https://doorkeeper.jp/',
    'https://luma.com/',
    'https://lu.ma/',
    'https://peatix.com/',
    'https://kanagawapm.peatix.com/',
    'https://techplay.jp/',
    'https://github.com/',
    'https://www.github.com/',
    'https://x.com/',
    'https://slide.community/',
  ])('Given %s, When it is checked, Then it is refused', (input) => {
    const check = checkCommunityLink(input)
    expect(check.ok).toBe(false)
    expect(check.ok ? null : check.reason).toMatch(
      /^(public_host|luma_calendar)$/,
    )
  })

  test('Given the list of sites anyone uses, When it is read, Then it holds the hosts D-32 names', () => {
    for (const host of [
      'connpass.com',
      'doorkeeper.jp',
      'luma.com',
      'lu.ma',
      'peatix.com',
      'techplay.jp',
      'github.com',
      'x.com',
    ])
      expect(PUBLIC_HOSTS.has(host), host).toBe(true)
  })
})

describe('F30-AC16: a connpass address without a group', () => {
  test('Given connpass.com itself, When it is checked as a link, Then it is refused, so no community holds the host of a groupless event', () => {
    expect(checkCommunityLink('https://connpass.com/')).toEqual({
      ok: false,
      reason: 'public_host',
    })
  })
})

describe('F30-AC17: the list of links', () => {
  const links = (count: number) =>
    Array.from({ length: count }, (_, i) => `https://group${i}.connpass.com/`)

  test('Given ten links, When the list is checked, Then all ten are kept', () => {
    const check = checkCommunityLinks(links(MAX_COMMUNITY_LINKS))
    expect(check.ok && check.links).toHaveLength(10)
  })

  test('Given eleven links, When the list is checked, Then it is refused as too many, every field kept', () => {
    const check = checkCommunityLinks(links(11))
    expect(check).toMatchObject({ ok: false, list: 'too_many' })
    expect(check.fields).toHaveLength(11)
  })

  test('Given only empty fields, When the list is checked, Then it is refused as none', () => {
    expect(checkCommunityLinks(['', '  '])).toEqual({
      ok: false,
      list: 'none',
      fields: [],
    })
  })

  test('Given the same link twice in two spellings, When the list is checked, Then it is kept once', () => {
    const check = checkCommunityLinks([
      'https://kanagawapm.connpass.com/',
      'http://KANAGAWAPM.connpass.com',
    ])
    expect(check.ok && check.links.map((link) => link.url)).toEqual([
      'https://kanagawapm.connpass.com/',
    ])
  })

  test('Given one good and one bad field, When the list is checked, Then only the bad one has a problem and both keep what was typed', () => {
    expect(
      checkCommunityLinks([
        'https://kanagawapm.connpass.com/',
        'https://x.com/ 🎉',
      ]),
    ).toEqual({
      ok: false,
      list: null,
      fields: [
        { value: 'https://kanagawapm.connpass.com/', problem: null },
        { value: 'https://x.com/ 🎉', problem: 'not_top' },
      ],
    })
  })
})
