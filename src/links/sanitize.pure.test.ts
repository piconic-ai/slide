import { describe, expect, test } from 'vitest'
import { parseHttpsUrl } from '../share/https-url'
import { sanitizedUrlOf } from './sanitize'
import { SITE_RULES, TRACKING_QUERY } from './url-rules'

/** The address a link leads to, from an address as an author types it. */
const hrefOf = (typed: string) => {
  const parsed = parseHttpsUrl(typed, 2000)
  if (!parsed.ok) throw new Error(`not an address: ${typed}`)
  return sanitizedUrlOf(parsed.url)
}

describe('sanitizedUrlOf: tracking parts', () => {
  test.each([...TRACKING_QUERY.names, 'utm_source', 'utm_medium', 'utm_'])(
    'F27-AC60: Given an address with %s in its query, When it is sanitized, Then that part is left out and the others stay',
    (name) => {
      expect(hrefOf(`https://example.com/a?b=2&${name}=x&a=1`)).toBe(
        'https://example.com/a?b=2&a=1',
      )
    },
  )

  test('F27-AC60: Given the list of tracking parts, When it is read, Then it is one piece of data next to the site rules', () => {
    expect(TRACKING_QUERY.prefixes).toEqual(['utm_'])
    expect(TRACKING_QUERY.names).toEqual([
      'fbclid',
      'gclid',
      'mc_cid',
      'mc_eid',
      'msclkid',
      'yclid',
      'dclid',
      'igshid',
      'ref_src',
      '_ga',
      '_gl',
    ])
  })

  test('F27-AC60: Given tracking parts with no value, no = or written twice, When it is sanitized, Then every one of them is left out', () => {
    expect(hrefOf('https://example.com/a?utm_source=&fbclid&q=1')).toBe(
      'https://example.com/a?q=1',
    )
    expect(
      hrefOf('https://example.com/a?utm_source=a&q=1&utm_source=b&gclid=c'),
    ).toBe('https://example.com/a?q=1')
  })

  test('F27-AC60: Given only tracking parts, When it is sanitized, Then no ? is left and the fragment stays', () => {
    expect(hrefOf('https://example.com/a/?utm_source=x&fbclid=y')).toBe(
      'https://example.com/a/',
    )
    expect(hrefOf('https://example.com/a?utm_source=x#intro')).toBe(
      'https://example.com/a#intro',
    )
  })

  test('F27-AC60: Given names that only look like tracking ones, When it is sanitized, Then they stay as written, since a query name is read as written', () => {
    for (const typed of [
      'https://example.com/a?UTM_SOURCE=x',
      'https://example.com/a?Fbclid=x',
      'https://example.com/a?xutm_source=x',
      'https://example.com/a?utm%5Fsource=x',
      'https://example.com/a?fbclid2=x',
      'https://example.com/a?q=utm_source',
    ])
      expect(hrefOf(typed)).toBe(typed)
  })

  test('F27-AC60: Given the other parts, When a tracking part is left out, Then the others keep their order, their values and how they are written', () => {
    expect(
      hrefOf('https://example.com/a?z=1&utm_source=x&a=b=c&q=a%20b+c&&y'),
    ).toBe('https://example.com/a?z=1&a=b=c&q=a%20b+c&&y')
  })

  test('F27-AC60: Given a Luma address, When it is sanitized, Then tk is left out under lu.ma, luma.com and www.luma.com', () => {
    expect(hrefOf('https://lu.ma/abc?tk=secret&x=1')).toBe(
      'https://lu.ma/abc?x=1',
    )
    expect(hrefOf('https://luma.com/abc?tk=secret')).toBe(
      'https://luma.com/abc',
    )
    expect(hrefOf('https://www.luma.com/abc?tk=secret')).toBe(
      'https://www.luma.com/abc',
    )
    expect(hrefOf('https://LU.MA./abc?tk=secret')).toBe('https://lu.ma./abc')
  })

  test('F27-AC60: Given tk on another host, When it is sanitized, Then it stays, since only Luma drops it', () => {
    for (const typed of [
      'https://example.com/a?tk=x',
      'https://events.lu.ma/abc?tk=x',
      'https://notluma.com/abc?tk=x',
    ])
      expect(hrefOf(typed)).toBe(typed)
  })

  test('F27-AC60: Given the site rules, When they are read, Then only Luma and Medium leave parts out of the address followed', () => {
    expect(
      SITE_RULES.filter((rule) => rule.hrefDroppedQuery.length > 0).map(
        (rule) => [rule.hosts, rule.hrefDroppedQuery],
      ),
    ).toEqual([
      [['lu.ma', 'luma.com'], ['tk']],
      [['medium.com'], ['source']],
    ])
  })
})

describe('sanitizedUrlOf: Medium', () => {
  test('F27-AC61: Given a Medium address, When it is sanitized, Then source is left out, on its subdomains too', () => {
    expect(hrefOf('https://medium.com/@a/post-abc?source=rss&x=1')).toBe(
      'https://medium.com/@a/post-abc?x=1',
    )
    expect(hrefOf('https://blog.medium.com/post-abc?source=rss')).toBe(
      'https://blog.medium.com/post-abc',
    )
  })

  test('F27-AC61: Given source on another host, When it is sanitized, Then it stays', () => {
    for (const typed of [
      'https://example.com/a?source=x',
      'https://notmedium.com/a?source=x',
      'https://medium.com.example/a?source=x',
    ])
      expect(hrefOf(typed)).toBe(typed)
  })
})

describe('sanitizedUrlOf: what it keeps', () => {
  test('F27-AC89: Given parts that are not sanitized, When it is sanitized, Then the trailing slash, the case of the path, the port and the fragment stay as typed', () => {
    for (const href of [
      'https://example.com/a/',
      'https://example.com/A/b//',
      'https://www.example.com:8443/a?b=1#Intro',
      'https://example.com/a?',
      'https://example.com/a#',
      'https://example.com/a?q=1#utm_source=x',
    ])
      expect(sanitizedUrlOf(href)).toBe(href)
  })

  test('F27-AC89: Given ? and # after a tracking part, When it is sanitized, Then only the query is read, not the fragment', () => {
    expect(hrefOf('https://example.com/a?utm_source=x#b?fbclid=y')).toBe(
      'https://example.com/a#b?fbclid=y',
    )
  })

  test('F26-AC100: Given an http: address, When it is sanitized, Then it is sanitized as an https: one', () => {
    expect(
      sanitizedUrlOf('http://medium.com/a?source=x&utm_source=y&q=1'),
    ).toBe('http://medium.com/a?q=1')
    expect(sanitizedUrlOf('http://lu.ma/a?tk=x')).toBe('http://lu.ma/a')
  })
})

describe('sanitizedUrlOf: characters a reader cannot see', () => {
  test('F27-AC52: Given invisible and direction characters in the path, the query and after #, When it is sanitized, Then each is in its % form', () => {
    const href = hrefOf('https://example.com/a‮b​?x=⁦y&utm_source=‏#c‮d')
    expect(href).toBe(
      'https://example.com/a%E2%80%AEb%E2%80%8B?x=%E2%81%A6y#c%E2%80%AEd',
    )
    expect(href).toMatch(/^[\x21-\x7e]+$/u)
  })

  test('F27-AC52: Given a direction character in the host, When the address is read, Then it is refused', () => {
    for (const typed of [
      'https://exa‮mple.com/',
      'https://exa⁦mple.com/',
      'https://example‮.com/',
    ])
      expect(parseHttpsUrl(typed, 2000)).toEqual({
        ok: false,
        reason: 'invalid',
      })
  })

  test('F27-AC52: Given a zero-width space in the host, When it is sanitized, Then the host is shown without it, as the browser goes there', () => {
    expect(hrefOf('https://exa​mple.com/a')).toBe('https://example.com/a')
  })
})
