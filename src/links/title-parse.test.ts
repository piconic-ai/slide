import { describe, expect, test } from 'vitest'
import {
  charsetOfPage,
  MAX_PAGE_BYTES,
  scanPage,
  titleOfPage,
} from './title-parse'

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
    expect(titleOfPage('<meta <meta <meta ><title>T</title>')).toBe('T')
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

describe('titleOfPage, the page as written', () => {
  test('F27-AC23: Given a character whose lower-case form is longer, When read, Then the title is whole (indexes do not move)', () => {
    expect(titleOfPage('İ<title>abc</title>')).toBe('abc')
    expect(titleOfPage('İİİİ<meta property="og:title" content="Shared">')).toBe(
      'Shared',
    )
    expect(titleOfPage('<TITLE>Upper</TITLE>')).toBe('Upper')
    expect(titleOfPage('<title lang="ja">With an attribute</title >')).toBe(
      'With an attribute',
    )
  })

  test('F27-AC23: Given an og:title whose value holds a ">", When read, Then the tag is not cut there', () => {
    expect(
      titleOfPage(
        '<meta property="og:title" content="A -> B"><title>Plain</title>',
      ),
    ).toBe('A -> B')
    expect(titleOfPage("<meta content='x > y' property='og:title'>")).toBe(
      'x > y',
    )
  })

  test('F27-AC23: Given tags that only start like title, When read, Then only a real <title> counts', () => {
    expect(titleOfPage('<titles>No</titles>')).toBeNull()
    expect(titleOfPage('<titlebar>No</titlebar><title>Yes</title>')).toBe('Yes')
    expect(titleOfPage('<title\n>Newline</title>')).toBe('Newline')
  })

  test('F27-AC23: Given a title in a comment, a script or a style, When read, Then it is skipped', () => {
    expect(titleOfPage('<!-- <title>Old</title> --><title>New</title>')).toBe(
      'New',
    )
    expect(
      titleOfPage(
        '<script>var s = "<title>In script</title>"</script><title>Real</title>',
      ),
    ).toBe('Real')
    expect(titleOfPage('<style>/* <title>x</title> */</style>')).toBeNull()
    expect(
      titleOfPage(
        '<!-- <meta property="og:title" content="Old"> --><title>New</title>',
      ),
    ).toBe('New')
    expect(titleOfPage('<script>never closed <title>T</title>')).toBeNull()
  })

  test('F27-AC28: Given a title with a character that could not be decoded, When read, Then there is no title', () => {
    expect(titleOfPage('<title>a\uFFFDb</title>')).toBeNull()
  })
})

describe('scanPage, the work it does', () => {
  // The work is counted, not timed: a count does not depend on the machine.
  const bound = (page: string) => 4 * page.length + 16

  test.each([
    ['names of 4000 characters', '<meta ' + 'a'.repeat(4000) + ' '],
    ['unclosed quotes', '<meta a="'],
    ['unclosed single quotes', "<meta a='"],
    ['tags that never close', '<meta '],
    ['title starts that never close', '<title '],
    ['stray equals signs', '<meta ====== '],
    ['nested angle brackets', '<<<<<<<<'],
    ['comment starts', '<!-- '],
    ['quotes inside names', '<meta a"b\'c="d" '],
  ])(
    'F27-AC27: Given a page of %s up to the limit, When scanned, Then the work is in proportion to its length',
    (_, unit) => {
      const page = unit
        .repeat(Math.ceil(MAX_PAGE_BYTES / unit.length))
        .slice(0, MAX_PAGE_BYTES)
      const { steps } = scanPage(page)
      expect(steps).toBeLessThanOrEqual(bound(page))
    },
  )

  test('F27-AC27: Given a page of long attribute lists and quoted values, When scanned, Then every character is looked at a bounded number of times', () => {
    const page = (
      '<meta ' +
      'x="' +
      '>'.repeat(3000) +
      '" y=z '.repeat(50) +
      '>'
    )
      .repeat(20)
      .slice(0, MAX_PAGE_BYTES)
    expect(scanPage(page).steps).toBeLessThanOrEqual(bound(page))
  })
})

describe('charsetOfPage', () => {
  test('F27-AC27: Given a Content-Type with a charset, When asked, Then it wins over the page', () => {
    expect(
      charsetOfPage('text/html; charset=Shift_JIS', '<meta charset="utf-8">'),
    ).toBe('Shift_JIS')
    expect(charsetOfPage('text/html;charset="euc-jp"', '')).toBe('euc-jp')
  })

  test('F27-AC27: Given no charset in the Content-Type, When asked, Then a <meta charset> or http-equiv in the first bytes names it', () => {
    expect(charsetOfPage('text/html', '<meta charset=shift_jis>')).toBe(
      'shift_jis',
    )
    expect(
      charsetOfPage(
        'text/html',
        '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=EUC-JP">',
      ),
    ).toBe('EUC-JP')
    expect(charsetOfPage('text/html', '<title>none</title>')).toBeNull()
  })

  test('F27-AC27: Given a <meta charset> far into the page, When asked, Then it is not looked for there', () => {
    expect(
      charsetOfPage('text/html', `${' '.repeat(2000)}<meta charset="sjis">`),
    ).toBeNull()
  })
})
