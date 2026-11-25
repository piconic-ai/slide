import { describe, expect, test } from 'vitest'
import {
  linkLabelOf,
  MAX_TITLE_LENGTH,
  parseLinkInput,
  siteNameOf,
} from './link'

const parse = (url: string, title = 'Recording', kind: unknown = 'video') =>
  parseLinkInput({ kind, url, title })

describe('parseLinkInput', () => {
  test('F27-AC36: Given each kind given with an https URL and a title, When parsed, Then that kind is used whatever the host is', () => {
    for (const kind of ['video', 'article', 'other'])
      expect(parse('https://example.com/a', 'T', kind)).toEqual({
        ok: true,
        link: { kind, url: 'https://example.com/a', title: 'T' },
      })
  })

  test('F27-AC36: Given a kind that is given and is not one of the three, When parsed, Then it is refused', () => {
    for (const kind of ['audio', 'Video', 3, {}])
      expect(parse('https://example.com/', 'T', kind)).toEqual({
        ok: false,
        reason: 'kind',
      })
  })

  test('F27-AC34: Given no kind (absent, null or empty), When parsed, Then the kind is read from the address', () => {
    for (const kind of [undefined, null, ''])
      expect(
        parseLinkInput({
          kind,
          url: 'https://www.youtube.com/watch?v=1',
          title: 'T',
        }),
      ).toMatchObject({ ok: true, link: { kind: 'video' } })
    expect(
      parseLinkInput({ url: 'https://zenn.dev/a/articles/b', title: 'T' }),
    ).toMatchObject({ ok: true, link: { kind: 'article' } })
    expect(
      parseLinkInput({ url: 'https://example.com/', title: '' }),
    ).toMatchObject({ ok: true, link: { kind: 'other', title: null } })
  })

  test.each([
    ['http://example.com/', 'url_scheme'],
    ['javascript:alert(1)', 'url_scheme'],
    ['data:text/html,hi', 'url_scheme'],
    ['ftp://example.com/', 'url_scheme'],
    ['//example.com/', 'url_invalid'],
    ['example.com', 'url_invalid'],
    ['', 'url_invalid'],
    ['   ', 'url_invalid'],
    ['https://exa mple.com/', 'url_invalid'],
    ['https://example.com/a b', 'url_invalid'],
    ['https://example.com/\nx', 'url_invalid'],
    ['https://user:pass@example.com/', 'url_credentials'],
    ['https://user@example.com/', 'url_credentials'],
    [`https://example.com/${'a'.repeat(2000)}`, 'url_too_long'],
  ])(
    'F27-AC5: Given the URL %j, When parsed, Then it is refused as %s',
    (url, reason) => {
      expect(parse(url)).toEqual({ ok: false, reason })
    },
  )

  test('F27-AC5: Given an https URL with surrounding spaces and an upper-case scheme, When parsed, Then it is normalized', () => {
    expect(parse('  HTTPS://Example.COM  ')).toMatchObject({
      ok: true,
      link: { url: 'https://example.com/' },
    })
  })

  test('F27-AC21: Given an empty or blank title, When parsed, Then the link is accepted with no title, to be fetched', () => {
    for (const title of ['', '   ', '\u3000', ' \t '])
      expect(parse('https://example.com/', title)).toEqual({
        ok: true,
        link: { kind: 'video', url: 'https://example.com/', title: null },
      })
    expect(
      parseLinkInput({
        kind: 'video',
        url: 'https://example.com/',
        title: null,
      }),
    ).toMatchObject({ ok: true, link: { title: null } })
    expect(
      parseLinkInput({ kind: 'video', url: 'https://example.com/' } as never),
    ).toMatchObject({ ok: true, link: { title: null } })
  })

  test('F27-AC22: Given a title that is not text, When parsed, Then it is refused, not fetched', () => {
    for (const title of [5, {}, ['a'], true, new File([], 'x')])
      expect(
        parseLinkInput({ kind: 'video', url: 'https://example.com/', title }),
      ).toEqual({ ok: false, reason: 'title_invalid' })
  })

  test('F27-AC22: Given a title with nothing a reader can see, When parsed, Then it is refused', () => {
    for (const title of ['\u3164', '\u2800', ' \u3164 '])
      expect(parse('https://example.com/', title)).toEqual({
        ok: false,
        reason: 'title_missing',
      })
  })

  test('F27-AC7: Given a title of exactly 100 characters, When parsed, Then it is accepted, and 101 is refused', () => {
    expect(parse('https://example.com/', 'a'.repeat(MAX_TITLE_LENGTH)).ok).toBe(
      true,
    )
    expect(parse('https://example.com/', 'a'.repeat(101))).toEqual({
      ok: false,
      reason: 'title_too_long',
    })
  })

  test('F27-AC7: Given titles of astral characters, When parsed, Then characters are counted, not code units', () => {
    expect(parse('https://example.com/', '😀'.repeat(100)).ok).toBe(true)
    expect(parse('https://example.com/', '😀'.repeat(101)).ok).toBe(false)
    expect(parse('https://example.com/', 'あ'.repeat(100)).ok).toBe(true)
  })

  test('F27-AC22: Given a title of zero-width characters only, When parsed, Then it is refused', () => {
    for (const title of ['\u200b', ' \u200b\u200c ', '\u200e'])
      expect(parse('https://example.com/', title)).toEqual({
        ok: false,
        reason: 'title_invalid',
      })
  })

  test('F27-AC22: Given a title with a line break or a direction override, When parsed, Then it is refused', () => {
    for (const title of ['a\nb', 'a‮b', 'a\u0000b'])
      expect(parse('https://example.com/', title)).toEqual({
        ok: false,
        reason: 'title_invalid',
      })
  })
})

describe('siteNameOf', () => {
  test('F27-AC3: Given URLs, When the site name is taken, Then it is the host name', () => {
    expect(siteNameOf('https://youtube.com/watch?v=1')).toBe('youtube.com')
    expect(siteNameOf('https://zenn.dev:8443/a/b#c')).toBe('zenn.dev')
    expect(siteNameOf('https://sub.Example.com/')).toBe('sub.example.com')
  })

  test('F27-AC3: Given an internationalized domain name, When the site name is taken, Then it is the ASCII form', () => {
    expect(siteNameOf('https://日本語.jp/')).toBe('xn--wgv71a119e.jp')
  })

  test('F27-AC3: Given text that is not a URL, When the site name is taken, Then it is empty', () => {
    expect(siteNameOf('nope')).toBe('')
  })
})

describe('linkLabelOf', () => {
  test('F27-AC39: Given links with and without a title, When labelled, Then the title or the site name', () => {
    expect(linkLabelOf({ url: 'https://zenn.dev/a', title: 'Notes' })).toBe(
      'Notes',
    )
    expect(linkLabelOf({ url: 'https://zenn.dev/a', title: null })).toBe(
      'zenn.dev',
    )
  })
})
