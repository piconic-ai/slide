import { describe, expect, test } from 'vitest'
import { MAX_PAGE_BYTES, titleOfPage } from './title-parse'

describe('titleOfPage', () => {
  test('F27-AC23: Given a page with only a <title>, When read, Then it is that title', () => {
    expect(titleOfPage('<html><head><title>My talk</title></head>')).toBe(
      'My talk',
    )
  })

  test('F27-AC23: Given a page with og:title and <title>, When read, Then og:title wins, in either attribute order and quote style', () => {
    const title = '<title>Plain</title>'
    expect(
      titleOfPage(`<meta property="og:title" content="Shared">${title}`),
    ).toBe('Shared')
    expect(
      titleOfPage(`<meta content='Shared' property='og:title'>${title}`),
    ).toBe('Shared')
    expect(titleOfPage(`${title}<META NAME=og:title CONTENT=Shared>`)).toBe(
      'Shared',
    )
    expect(
      titleOfPage(`<meta property="og:title" content="Shared" />${title}`),
    ).toBe('Shared')
  })

  test('F27-AC23: Given an og:title that is empty, When read, Then the <title> is used', () => {
    expect(
      titleOfPage('<meta property="og:title" content=" "><title>Plain</title>'),
    ).toBe('Plain')
  })

  test('F27-AC23: Given character references, When read, Then they are decoded once', () => {
    expect(
      titleOfPage('<title>Tom &amp; Jerry &#x30c6;&#12473;&#12488;</title>'),
    ).toBe('Tom & Jerry テスト')
    expect(
      titleOfPage('<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>'),
    ).toBe('<script>alert(1)</script>')
    expect(titleOfPage('<title>&amp;amp;</title>')).toBe('&amp;')
  })

  test('F27-AC23: Given a Japanese title across lines, When read, Then white space is one space and the title is kept', () => {
    expect(titleOfPage('<title>\n  発表の録画\n  | 例のサイト\n</title>')).toBe(
      '発表の録画 | 例のサイト',
    )
  })

  test('F27-AC23: Given a title over 100 characters, When read, Then it is cut to 100', () => {
    expect(titleOfPage(`<title>${'あ'.repeat(300)}</title>`)).toBe(
      'あ'.repeat(100),
    )
  })

  test.each([
    ['no title at all', '<html><body>hello</body></html>'],
    ['an empty title', '<title></title>'],
    ['a title that is not closed', '<title>Never closed'],
    ['a page cut inside the title tag', '<head><title'],
    ['a page cut inside a meta tag', '<meta property="og:title" content="Cut'],
    ['an empty page', ''],
    ['a title of control characters', '<title>a&#7;b</title>'],
    ['a title of a zero-width space', '<title>&#x200b;</title>'],
    ['a title with a direction override', '<title>a&#x202e;b</title>'],
  ])(
    'F27-AC24: Given %s, When read, Then there is no title (null)',
    (_, page) => {
      expect(titleOfPage(page)).toBeNull()
    },
  )

  test('F27-AC28: Given a title that holds a script tag, When read, Then it is only text (null-free, never markup removed or run)', () => {
    expect(titleOfPage('<title>a <b>bold</b> move</title>')).toBe(
      'a <b>bold</b> move',
    )
  })

  test('F27-AC24: Given broken HTML around the title, When read, Then the title is still found', () => {
    expect(
      titleOfPage(
        '<<<meta <meta property="og:title" <html><title>Found</title>',
      ),
    ).toBe('Found')
    expect(titleOfPage('<meta <meta <meta <title>T</title>')).toBe('T')
  })

  test('F27-AC27: Given a page that is longer than the limit, When read, Then only the start is looked at', () => {
    const filler = 'x'.repeat(MAX_PAGE_BYTES)
    expect(titleOfPage(`${filler}<title>Late</title>`)).toBeNull()
    expect(titleOfPage(`<title>Early</title>${filler}`)).toBe('Early')
  })

  test('F27-AC27: Given a huge page of unclosed tags, When read, Then it takes time in proportion to its length', () => {
    const started = performance.now()
    expect(titleOfPage('<meta '.repeat(20000))).toBeNull()
    expect(titleOfPage('<title '.repeat(20000))).toBeNull()
    expect(titleOfPage('<meta a="'.repeat(20000))).toBeNull()
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
