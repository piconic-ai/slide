import { describe, expect, it, test } from 'vitest'
import {
  eventPagePath,
  linkPagePath,
  linkTargetOf,
  parseLinkPath,
} from './link-address'

/** The canonical `rest` a written `rest` leads to, or 'refused'. */
const canonical = (rest: string) => {
  const path = parseLinkPath(rest)
  return path.kind === 'refused' ? 'refused' : linkTargetOf(path.url).rest
}

const targetOf = (rest: string) => {
  const path = parseLinkPath(rest)
  if (path.kind === 'refused') throw new Error(`refused: ${rest}`)
  return linkTargetOf(path.url)
}

const WRITTEN: readonly (readonly [string, string])[] = [
  ['https://example.com/a?b=1', 'example.com/a?b=1'],
  ['https:/example.com/a?b=1', 'example.com/a?b=1'],
  ['http://example.com/a?b=1', 'example.com/a?b=1'],
  ['HTTPS://EXAMPLE.com/a/?b=1&utm_source=x', 'example.com/a?b=1'],
  ['www.example.com/a?b=1', 'example.com/a?b=1'],
  ['https%3A%2F%2Fexample.com%2Fa%3Fb%3D1', 'example.com/a?b=1'],
  ['HTTP%3a%2f%2fexample.com%2Fa%3Fb%3D1', 'example.com/a?b=1'],
  ['youtu.be/ID?t=30', 'youtube.com/watch?v=ID'],
  ['www.youtube.com/watch?v=ID&t=5', 'youtube.com/watch?v=ID'],
  ['kanagawapm.connpass.com/event/0410635/?x=1', 'connpass.com/event/410635'],
  ['connpass.com/event/410635', 'connpass.com/event/410635'],
  ['a.b.connpass.com/event/007', 'connpass.com/event/7'],
  ['group.doorkeeper.jp/events/007?x=1', 'group.doorkeeper.jp/events/7'],
  ['lu.ma/AbC?tk=1', 'luma.com/AbC'],
  ['example.com:8443/a', 'example.com:8443/a'],
  ['example.com:443/a', 'example.com/a'],
  ['例え.jp/パス?q=値', 'xn--r8jz45g.jp/%E3%83%91%E3%82%B9?q=%E5%80%A4'],
  ['example.com', 'example.com/'],
  ['example.com/', 'example.com/'],
  ['example.com/?', 'example.com/'],
  // `%` forms are kept as written, never read.
  ['example.com/a%2Fb', 'example.com/a%2Fb'],
  ['example.com/A%41', 'example.com/A%41'],
  ['example.com//a', 'example.com//a'],
  ['//example.com/a', 'example.com/a'],
  ['www.www.example.com/a', 'example.com/a'],
  ['example.com\\@evil.example/a', 'example.com/@evil.example/a'],
  ['example.com/<b>"?q=<i>"', 'example.com/%3Cb%3E%22?q=%3Ci%3E%22'],
]

const REFUSED: readonly string[] = [
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  'data:text/html,x',
  'mailto:a@example.com',
  'ftp://example.com/',
  'https://user:pw@example.com/a',
  'user:123@example.com',
  'user@example.com/a',
  'https:https://example.com/',
  'https://',
  '',
  '/',
  '.',
  'example.com..',
  '%E0%A4%A',
  'https%3A%2F%2F%ZZ',
  'https%3A%2F%2Fexam%0Aple.com',
  'exam ple.com/a',
  `example.com/${'a'.repeat(1981)}`,
]

describe('parseLinkPath and linkTargetOf', () => {
  it.each(WRITTEN)(
    'F45-AC31: Given /link/%s, When it is read, Then its page is /link/%s',
    (written, rest) => {
      expect(canonical(written)).toBe(rest)
    },
  )

  it.each(WRITTEN)(
    'F45-AC31: Given /link/%s, When its canonical path is read again, Then it does not change and never starts with a slash',
    (written) => {
      const rest = canonical(written)
      expect(canonical(rest)).toBe(rest)
      expect(rest).toMatch(/^[^/\\#]/u)
      expect(linkPagePath(`https://${rest}`)).toBe(`/link/${rest}`)
    },
  )

  it.each(REFUSED)(
    'F45-AC13: Given /link/%s, When it is read, Then it is refused',
    (written) => {
      expect(parseLinkPath(written)).toEqual({ kind: 'refused' })
    },
  )

  test('F45-AC13: Given an address of exactly 2000 characters, When it is read, Then it is kept, and one more character is refused', () => {
    const rest = `example.com/${'a'.repeat(1980)}`
    expect(`https://${rest}`).toHaveLength(2000)
    expect(canonical(rest)).toBe(rest)
    expect(canonical(`${rest}a`)).toBe('refused')
  })

  test('F45-AC13: Given a host and its port, When it is read, Then it is not taken for another scheme', () => {
    expect(canonical('localhost:8787/a?b=1')).toBe('localhost:8787/a?b=1')
    expect(canonical('example.com:99999/a')).toBe('refused')
  })

  test('F45-AC32: Given a rest with # (a browser never sends one), When it is read, Then what follows # is left out', () => {
    expect(canonical('example.com/a#intro')).toBe('example.com/a')
    expect(canonical('example.com/a?b=1#c')).toBe('example.com/a?b=1')
    expect(canonical('https%3A%2F%2Fexample.com%2Fa%23x')).toBe('example.com/a')
    // An encoded # is part of the path, not a fragment.
    expect(canonical('example.com/a%23x')).toBe('example.com/a%23x')
  })

  test('F45-AC33: Given lang in the query, When it is read, Then it is a query name of the address like any other', () => {
    expect(canonical('example.com/a?lang=en')).toBe('example.com/a?lang=en')
    expect(targetOf('example.com/a?lang=en&b=1').gatherKey).toBe(
      'https://example.com/a?b=1&lang=en',
    )
  })

  test('F45-AC35: Given an address of connpass, Doorkeeper or Luma, When it is read, Then it is looked up by the key of its event without its query', () => {
    expect(targetOf('kanagawapm.connpass.com/event/0410635/?x=1')).toEqual({
      rest: 'connpass.com/event/410635',
      eventShaped: true,
      eventKey: 'https://connpass.com/event/410635',
      eventRest: 'connpass.com/event/410635',
      gatherKey: 'https://connpass.com/event/410635',
    })
    expect(targetOf('group.doorkeeper.jp/events/5?x=1').eventKey).toBe(
      'https://group.doorkeeper.jp/events/5',
    )
    // The key of a Luma event keeps the case its compared form drops.
    expect(targetOf('lu.ma/AbC?tk=1')).toMatchObject({
      eventKey: 'https://luma.com/AbC',
      gatherKey: 'https://luma.com/abc',
    })
  })

  test('F45-AC35: Given an address of another site, When it has no query, Then it is looked up by the key an event of that host and path has, and with a query only by the gathered key', () => {
    expect(targetOf('example.com/conf/2026/')).toEqual({
      rest: 'example.com/conf/2026',
      eventShaped: false,
      eventKey: 'https://example.com/conf/2026',
      eventRest: 'example.com/conf/2026',
      gatherKey: 'https://example.com/conf/2026',
    })
    expect(targetOf('example.com/')).toMatchObject({
      eventKey: 'https://example.com',
      gatherKey: 'https://example.com/',
    })
    expect(targetOf('example.com/conf?day=1')).toMatchObject({
      eventShaped: false,
      eventKey: null,
      gatherKey: 'https://example.com/conf?day=1',
    })
    // A tracking name is not a query of the address.
    expect(targetOf('example.com/conf?utm_source=x').eventKey).toBe(
      'https://example.com/conf',
    )
  })

  test.each([40, 60, 400])(
    'F45-AC31: Given an address with www. written %i times, When it is read, Then no www. is left and reading it again changes nothing',
    (times) => {
      const rest = canonical(`${'www.'.repeat(times)}example.com/a`)
      expect(rest).toBe('example.com/a')
      expect(canonical(rest)).toBe(rest)
    },
  )

  test('F45-AC35: Given an address of another site whose compared form differs from it, When it is read, Then an event is looked up by the address as written and the other links by the compared form', () => {
    // The compared form of a Loom embed is its share page.
    expect(targetOf('loom.com/embed/x')).toEqual({
      rest: 'loom.com/share/x',
      eventShaped: false,
      eventKey: 'https://loom.com/embed/x',
      eventRest: 'loom.com/embed/x',
      gatherKey: 'https://loom.com/share/x',
    })
    // The compared form of an unlisted Vimeo video carries a query the
    // written address does not have.
    expect(targetOf('vimeo.com/123/abc')).toMatchObject({
      rest: 'vimeo.com/123?h=abc',
      eventKey: 'https://vimeo.com/123/abc',
      eventRest: 'vimeo.com/123/abc',
    })
    expect(targetOf('www.youtube.com/watch?v=ID')).toMatchObject({
      eventKey: null,
      eventRest: null,
      gatherKey: 'https://youtube.com/watch?v=ID',
    })
  })

  test('F45-AC35: Given addresses of another site with and without www., When they are read, Then each is looked up as its own event and both gather the other links under one key', () => {
    expect(targetOf('https://WWW.Example.com/conf/')).toEqual({
      rest: 'example.com/conf',
      eventShaped: false,
      eventKey: 'https://www.example.com/conf',
      eventRest: 'www.example.com/conf',
      gatherKey: 'https://example.com/conf',
    })
    expect(targetOf('example.com/conf')).toMatchObject({
      eventKey: 'https://example.com/conf',
      eventRest: 'example.com/conf',
      gatherKey: 'https://example.com/conf',
    })
  })

  test('F45-AC9: Given the address of an event, When the path of its page is made, Then connpass, Doorkeeper and Luma have the canonical path and another site its address as written', () => {
    expect(eventPagePath('https://connpass.com/event/7/')).toBe(
      '/link/connpass.com/event/7',
    )
    expect(eventPagePath('https://group.doorkeeper.jp/events/5')).toBe(
      '/link/group.doorkeeper.jp/events/5',
    )
    expect(eventPagePath('https://luma.com/AbC')).toBe('/link/luma.com/AbC')
    expect(eventPagePath('https://www.example.com/conf/')).toBe(
      '/link/www.example.com/conf',
    )
    expect(eventPagePath('https://example.com/conf')).toBe(
      '/link/example.com/conf',
    )
    expect(eventPagePath('https://loom.com/embed/x')).toBe(
      '/link/loom.com/embed/x',
    )
    expect(eventPagePath('https://vimeo.com/123/abc')).toBe(
      '/link/vimeo.com/123/abc',
    )
    expect(eventPagePath('https://example.com/')).toBe('/link/example.com')
  })

  test.each([
    'https://www.example.com/conf/',
    'https://loom.com/embed/x',
    'https://vimeo.com/123/abc',
    'https://connpass.com/event/7/',
    'https://example.com/',
  ])(
    'F45-AC31: Given the path of the page of the event %s, When it is read again, Then it names the same event and the same path',
    (eventUrl) => {
      const path = eventPagePath(eventUrl)
      const again = targetOf(path.slice('/link/'.length))
      expect(again.eventKey).toBe(linkTargetOf(eventUrl).eventKey)
      expect(`/link/${again.eventRest}`).toBe(path)
    },
  )
})
