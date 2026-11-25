import { describe, expect, test } from 'vitest'
import { parseHttpsUrl } from '../share/https-url'
import { isTrackingQuery, normalizedUrlOf } from './normalize'
import { TRACKING_QUERY } from './url-rules'

/** The compared form of an address as an author types it. */
const formOf = (typed: string) => {
  const parsed = parseHttpsUrl(typed, 2000)
  if (!parsed.ok) throw new Error(`not an address: ${typed}`)
  return normalizedUrlOf(parsed.url)
}

const expectSame = (...addresses: string[]) => {
  const [first, ...rest] = addresses.map(formOf)
  for (const form of rest) expect(form).toBe(first)
}

const expectApart = (...addresses: string[]) => {
  const forms = addresses.map(formOf)
  expect(new Set(forms).size).toBe(addresses.length)
}

describe('normalizedUrlOf: the common rules', () => {
  test('F27-AC62: Given addresses that differ only in the case of the scheme and host, the default port and a final dot, When they are compared, Then they are the same', () => {
    expectSame(
      'HTTPS://Example.COM:443/a',
      'https://example.com./a',
      'https://example.com/a',
    )
    expect(formOf('HTTPS://Example.COM:443/a')).toBe('https://example.com/a')
  })

  test('F27-AC62: Given another port, When it is compared with the default one, Then they stay apart', () => {
    expectApart('https://example.com:8443/a', 'https://example.com/a')
  })

  test('F27-AC63: Given addresses that differ only after #, When they are compared, Then they are the same', () => {
    expectSame(
      'https://example.com/a#intro',
      'https://example.com/a',
      'https://example.com/a#',
    )
  })

  test('F27-AC64: Given addresses that differ only in a trailing slash, When they are compared, Then they are the same, and a path of / alone stays', () => {
    expectSame('https://example.com/a/', 'https://example.com/a')
    expectSame('https://example.com', 'https://example.com/')
    expect(formOf('https://example.com')).toBe('https://example.com/')
    expectSame('https://example.com/a//', 'https://example.com/a')
    expectSame('https://example.com/a/?q=1', 'https://example.com/a?q=1')
  })

  test('F27-AC65: Given addresses that differ only in a leading www., When they are compared, Then they are the same, and only the leading one is dropped', () => {
    expectSame('https://www.example.com/a', 'https://example.com/a')
    expectApart('https://wwwexample.com/a', 'https://example.com/a')
    expectApart('https://a.www.example.com/a', 'https://a.example.com/a')
  })

  test('F27-AC66: Given addresses whose query parts differ only in order, When they are compared, Then they are the same', () => {
    expectSame('https://example.com/a?b=2&a=1', 'https://example.com/a?a=1&b=2')
    expect(formOf('https://example.com/a?b=2&a=1')).toBe(
      'https://example.com/a?a=1&b=2',
    )
  })

  test('F27-AC66: Given parts of one name in another order, When they are compared, Then they stay apart, since the order of one name can matter', () => {
    expectApart(
      'https://example.com/a?a=2&a=1',
      'https://example.com/a?a=1&a=2',
    )
    expect(formOf('https://example.com/a?b=1&a=2&a=1')).toBe(
      'https://example.com/a?a=2&a=1&b=1',
    )
  })

  test('F27-AC66: Given an empty query and empty parts, When they are compared, Then they are the same as none', () => {
    expectSame(
      'https://example.com/a?',
      'https://example.com/a?&',
      'https://example.com/a',
    )
    expectSame('https://example.com/a?&b=1&&', 'https://example.com/a?b=1')
  })

  test('F27-AC67: Given addresses that differ only in tracking parts, When they are compared, Then they are the same', () => {
    expectSame(
      'https://example.com/a?utm_source=x&fbclid=y',
      'https://example.com/a',
    )
    const every = [
      ...TRACKING_QUERY.prefixes.map((prefix) => `${prefix}campaign`),
      ...TRACKING_QUERY.names,
    ]
    expectSame(
      `https://example.com/a?q=1&${every.map((name) => `${name}=v`).join('&')}`,
      'https://example.com/a?q=1',
    )
    expectSame('https://lu.ma/abc?tk=secret', 'https://lu.ma/abc')
    expectSame('https://medium.com/@a/b?source=rss', 'https://medium.com/@a/b')
  })

  test.each([
    ['utm', false],
    ['UTM_source', false],
    ['xutm_source', false],
    ['gclid2', false],
    ['utm_', true],
    ['utm_medium', true],
    ['_gl', true],
  ])(
    'F27-AC67: Given the query name %s, When it is checked, Then it is tracking: %s',
    (name, tracking) => {
      expect(isTrackingQuery(name)).toBe(tracking)
    },
  )

  test('F27-AC67: Given source and tk on other sites, When they are compared, Then they stay, since only Medium and Luma drop them', () => {
    expectApart('https://example.com/a?source=x', 'https://example.com/a')
    expectApart('https://example.com/a?tk=x', 'https://example.com/a')
  })

  test('F27-AC68: Given paths that differ in case, When they are compared, Then they stay apart', () => {
    expectApart('https://example.com/A', 'https://example.com/a')
    expectApart(
      'https://zenn.dev/A/articles/x',
      'https://zenn.dev/a/articles/x',
    )
  })

  test('F27-AC68: Given values that differ in case or in how they are written, When they are compared, Then they stay apart', () => {
    expectApart('https://example.com/a?q=A', 'https://example.com/a?q=a')
    expectApart('https://example.com/a?q', 'https://example.com/a?q=')
  })

  test.each([
    ['https://example.com/ü', 'https://example.com/%C3%BC'],
    ['https://例え.jp/a', 'https://xn--r8jz45g.jp/a'],
    ['https://example.com/a/../b', 'https://example.com/b'],
  ])(
    'F27-AC62: Given %s, When it is compared with how the URL parser writes it, Then they are the same',
    (typed, written) => {
      expectSame(typed, written)
    },
  )
})

describe('normalizedUrlOf: events', () => {
  test('F27-AC69: Given a connpass event with and without a group subdomain, When they are compared, Then they are the same', () => {
    expectSame(
      'https://connpass.com/event/300000/',
      'https://pieceofcake.connpass.com/event/300000/',
      'https://pieceofcake.connpass.com/event/300000',
    )
  })

  test('F27-AC69: Given another event, or a group page under two groups, When they are compared, Then they stay apart', () => {
    expectApart(
      'https://connpass.com/event/300000/',
      'https://connpass.com/event/300001/',
    )
    expectApart('https://a.connpass.com/', 'https://b.connpass.com/')
    expectApart(
      'https://a.connpass.com/event/x/',
      'https://b.connpass.com/event/x/',
    )
    expectApart(
      'https://connpass.com.example/event/1/',
      'https://connpass.com/event/1/',
    )
  })

  test('F27-AC70: Given the pages under a connpass event, When they are compared, Then they are apart from the event and from each other, under any group', () => {
    expectApart(
      'https://connpass.com/event/300000/',
      'https://connpass.com/event/300000/presentation/',
      'https://connpass.com/event/300000/participation/',
    )
    expectSame(
      'https://connpass.com/event/300000/presentation/',
      'https://pieceofcake.connpass.com/event/300000/presentation/',
    )
  })

  test('F27-AC71: Given a Luma slug under lu.ma, luma.com and www.luma.com, When they are compared, Then they are the same', () => {
    expectSame(
      'https://lu.ma/abc',
      'https://luma.com/abc',
      'https://www.luma.com/abc',
    )
    expectApart('https://luma.com/abc', 'https://luma.com/abd')
  })

  test('F27-AC72: Given Luma slugs that differ only in case, When they are compared, Then they are the same', () => {
    expectSame(
      'https://luma.com/cjihmlt6',
      'https://luma.com/CJIHMLT6',
      'https://lu.ma/Cjihmlt6',
    )
    expectApart('https://example.com/CJIHMLT6', 'https://example.com/cjihmlt6')
  })
})

describe('normalizedUrlOf: what it gives back', () => {
  test.each([
    'https://example.com/',
    'https://example.com/a?q=1',
    'https://connpass.com/event/1',
    'https://luma.com/abc',
  ])(
    'F27-AC62: Given the compared form %s, When it is compared again, Then it does not change',
    (form) => {
      expect(formOf(form)).toBe(form)
    },
  )

  test('F27-AC62: Given markup and quotes in an address, When it is compared, Then the form is a plain https address with them encoded', () => {
    const form = formOf('https://example.com/<a>"x"?q=<b>')
    expect(form.startsWith('https://example.com/')).toBe(true)
    expect(form).not.toMatch(/[<>"\s]/u)
  })
})
