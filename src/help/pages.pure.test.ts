import { beforeAll, describe, expect, test } from 'vitest'
import { html } from 'hono/html'
import { HELP_AIMS } from './aims'
import { defineArticle, type Article } from './article'
import { buildCatalog, findArticle, type RegisteredArticle } from './catalog'
import { HELP_CATALOG } from './default-catalog'
import { helpNumbers } from './numbers'
import {
  ENTRANCE_ARTICLES,
  HELP_PAGE_POLICY,
  HELP_SEARCH_PAGE_POLICY,
  helpAimPage,
  helpArticlePage,
  helpEntryPage,
  helpSearchPage,
} from './pages'
import {
  buildSearchIndex,
  parseQuery,
  searchHelp,
  type SearchIndex,
} from './search'

const squash = (text: string) => text.replace(/\s+/g, '')
const url = (path: string) => new URL(`https://slide.example${path}`)
const page = async (rendered: unknown) => flat(String(await rendered))
const flat = (rendered: string) => rendered.replace(/>\s+</g, '><')
const main = (rendered: string) => /<main[\s\S]*<\/main>/.exec(rendered)![0]

const fixture = (
  title: string,
  related: readonly string[] = [],
  order = 10,
): Article =>
  defineArticle({
    order,
    form: 'reference',
    related,
    ja: {
      title: `${title}を使う`,
      lead: () => html`${title}の答えです。`,
      body: () => html`<p>${title}の本文。</p>`,
    },
    en: {
      title: `Use ${title}`,
      lead: () => html`The answer on ${title}.`,
      body: () => html`<p>Body of ${title}.</p>`,
    },
  })

const registered: RegisteredArticle[] = [
  ['slides/a', fixture('A', ['slides/b', 'slides/c', 'slides/d'], 1)],
  ['slides/b', fixture('B', [], 2)],
  ['slides/c', fixture('C', [], 3)],
  ['slides/d', fixture('D', [], 4)],
  ['slides/e', fixture('E', [], 5)],
  ['start/x', fixture('X')],
  ['safety/y', fixture('Y')],
]
const small = buildCatalog(registered)

describe('the entrance', () => {
  test('F36-AC1: Given the entrance, When it is drawn, Then it has a search form that sends a word to the help with no script', async () => {
    const ja = squash(await page(helpEntryPage('ja', url('/help'), small)))
    expect(ja).toContain(
      squash('<form class="help-search" method="get" action="/help"'),
    )
    expect(ja).toContain(squash('type="search"'))
    expect(ja).toContain(squash('name="q"'))
    expect(ja).toContain(squash('>探す</button>'))
    const en = squash(await page(helpEntryPage('en', url('/help'), small)))
    expect(en).toContain(squash('>Search</button>'))
  })

  test('F36-AC2: Given the entrance, When it is drawn, Then the eight aims are in order, each a link to its list', async () => {
    const ja = await page(helpEntryPage('ja', url('/help'), HELP_CATALOG))
    const links = [
      ...ja.matchAll(/<h2><a href="(\/help\/[a-z]+)">([^<]+)<\/a><\/h2>/g),
    ].map((match) => [match[1], match[2]])
    expect(links).toEqual([
      ['/help/start', 'はじめる'],
      ['/help/slides', 'スライドを置く・直す'],
      ['/help/articles', '記事とリンクを添える'],
      ['/help/sharing', '読む・共有する'],
      ['/help/community', 'つながる'],
      ['/help/agent', 'AI エージェント'],
      ['/help/account', 'アカウントとデータ'],
      ['/help/safety', '安全と規約'],
    ])
    expect(links.map(([href]) => href)).toEqual(
      HELP_AIMS.map((aim) => `/help/${aim}`),
    )
  })

  test('F36-AC3: Given an aim with more than three articles, When the entrance is drawn, Then it names three of them, in the list’s order, and a one-line summary', async () => {
    expect(ENTRANCE_ARTICLES).toBe(3)
    const ja = await page(helpEntryPage('ja', url('/help'), small))
    const slides =
      /<section class="help-aim">\s*<h2><a href="\/help\/slides">[\s\S]*?<\/section>/.exec(
        ja,
      )![0]
    expect(
      [...slides.matchAll(/<li><a href="([^"]+)"/g)].map((m) => m[1]),
    ).toEqual(['/help/slides/a', '/help/slides/b', '/help/slides/c'])
    expect(slides).toContain('class="help-aim-summary"')
    // An aim with none shows its name and summary and an empty list.
    expect(ja).toContain('<a href="/help/agent">AI エージェント</a>')
  })

  test('F36-AC4: Given the entrance, When it is drawn, Then it says where to go when nothing is found', async () => {
    expect(
      squash(await page(helpEntryPage('ja', url('/help'), small))),
    ).toContain(
      squash('見つからないときは、<a href="/contact">お問い合わせ</a>へ。'),
    )
    expect(
      squash(await page(helpEntryPage('en', url('/help'), small))),
    ).toContain(squash('Cannot find it? <a href="/contact">Contact us</a>.'))
  })

  test('F36-AC13: Given the entrance in English, When it is drawn, Then it is in English and the page says so', async () => {
    const en = await page(
      helpEntryPage('en', url('/help?lang=en'), HELP_CATALOG),
    )
    expect(en).toContain('<html lang="en">')
    expect(en).toContain('<h1>Help</h1>')
    expect(en).toContain('Getting started')
    expect(main(en)).not.toMatch(/[぀-ヿ一-鿿]/)
  })

  test('F36-AC29: Given the entrance’s style, When it is read, Then the aims are two columns, one under 600px, and the page does not set a width that overflows', async () => {
    const ja = squash(await page(helpEntryPage('ja', url('/help'), small)))
    expect(ja).toContain(
      squash('grid-template-columns: repeat(2, minmax(0, 1fr))'),
    )
    expect(ja).toContain(squash('@media (max-width: 599px)'))
    expect(ja).toContain(squash('grid-template-columns: minmax(0, 1fr)'))
  })

  test('F36-AC22: Given the entrance, When it is drawn, Then it does not ask search engines to leave it out', async () => {
    expect(await page(helpEntryPage('ja', url('/help'), small))).not.toContain(
      'noindex',
    )
  })
})

describe('the list of an aim', () => {
  test('F36-AC5: Given an aim, When its list is drawn, Then it has the breadcrumbs, the aim as the title, and each article’s title and first sentence', async () => {
    const ja = await page(
      await helpAimPage('ja', url('/help/slides'), 'slides', small),
    )
    expect(squash(ja)).toContain(
      squash(
        '<li><a href="/help">ヘルプ</a></li><li aria-current="page">スライドを置く・直す</li>',
      ),
    )
    expect(ja).toContain('<h1>スライドを置く・直す</h1>')
    expect(ja).toContain('aria-label="パンくず"')
    const items = [
      ...ja.matchAll(
        /<li><a href="(\/help\/slides\/[^"]+)">([^<]+)<\/a><p>([^<]+)<\/p><\/li>/g,
      ),
    ].map((m) => [m[1], m[2], m[3]])
    expect(items).toEqual([
      ['/help/slides/a', 'Aを使う', 'Aの答えです。'],
      ['/help/slides/b', 'Bを使う', 'Bの答えです。'],
      ['/help/slides/c', 'Cを使う', 'Cの答えです。'],
      ['/help/slides/d', 'Dを使う', 'Dの答えです。'],
      ['/help/slides/e', 'Eを使う', 'Eの答えです。'],
    ])
  })

  test('F36-AC24: Given the list of the safety aim, When it is drawn, Then it links to the bot’s page, and no other aim’s does', async () => {
    const safety = await page(
      await helpAimPage('ja', url('/help/safety'), 'safety', HELP_CATALOG),
    )
    expect(safety).toContain('<a href="/help/bot">配信を読むボット</a>')
    const en = await page(
      await helpAimPage('en', url('/help/safety'), 'safety', HELP_CATALOG),
    )
    expect(en).toContain('<a href="/help/bot">The feed-reading bot</a>')
    for (const aim of HELP_AIMS.filter((aim) => aim !== 'safety'))
      expect(
        await page(
          await helpAimPage('ja', url(`/help/${aim}`), aim, HELP_CATALOG),
        ),
      ).not.toContain('/help/bot')
  })
})

describe('an article', () => {
  test('F36-AC6: Given an article, When it is drawn, Then the breadcrumbs name the help, the aim and the article, and the article is the current page', async () => {
    const entry = findArticle(small, 'slides', 'a')!
    const ja = await page(
      await helpArticlePage('ja', url(entry.path), entry, small),
    )
    expect(squash(ja)).toContain(
      squash(
        '<li><a href="/help">ヘルプ</a></li><li><a href="/help/slides">スライドを置く・直す</a></li><li aria-current="page">Aを使う</li>',
      ),
    )
    expect(ja).toContain('<h1>Aを使う</h1>')
    expect(ja).toContain('<p class="help-lead">Aの答えです。</p>')
    expect(ja).toContain('<p>Aの本文。</p>')
    expect(ja.match(/aria-current="page"/g)).toHaveLength(1)
    expect(ja).toContain('<meta name="description" content="Aの答えです。" />')
  })

  test('F36-AC7: Given an article that names related articles, When it is drawn, Then they are listed in its order, and the way to ask is at the end', async () => {
    const entry = findArticle(small, 'slides', 'a')!
    const ja = await page(
      await helpArticlePage('ja', url(entry.path), entry, small),
    )
    const related = /<section class="help-related">[\s\S]*?<\/section>/.exec(
      ja,
    )![0]
    expect([...related.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual([
      '/help/slides/b',
      '/help/slides/c',
      '/help/slides/d',
    ])
    const unresolved =
      /<section class="help-unresolved">[\s\S]*?<\/section>/.exec(ja)![0]
    expect(squash(unresolved)).toContain(squash('<h2>解決しないときは</h2>'))
    expect(unresolved).toContain('<a href="/contact">お問い合わせ</a>')
    expect(ja.indexOf('class="help-related"')).toBeLessThan(
      ja.indexOf('class="help-unresolved"'),
    )
  })

  test('F36-AC7: Given an article with no related article, When it is drawn, Then there is no empty heading, and the way to ask stays', async () => {
    const entry = findArticle(small, 'start', 'x')!
    const en = await page(
      await helpArticlePage('en', url(entry.path), entry, small),
    )
    expect(en).not.toContain('class="help-related"')
    expect(en).toContain('<a href="/contact">Contact us</a>')
    expect(en).toContain('<h1>Use X</h1>')
  })

  test('F36-AC6: Given every article of the help, When it is drawn in each language, Then the page is made with one h1', async () => {
    for (const entry of HELP_CATALOG)
      for (const lang of ['ja', 'en'] as const) {
        const rendered = await page(
          await helpArticlePage(lang, url(entry.path), entry, HELP_CATALOG),
        )
        expect(rendered.match(/<h1>/g)).toHaveLength(1)
        expect(rendered).toContain('class="help-lead"')
      }
  })
})

describe('the answer to a search', () => {
  let index: SearchIndex
  beforeAll(async () => {
    index = await buildSearchIndex(HELP_CATALOG, helpNumbers())
  })
  const search = (raw: string, lang: 'ja' | 'en' = 'ja') => {
    const query = parseQuery(raw)
    if (query.kind !== 'words') throw new Error('empty')
    return page(
      helpSearchPage(
        lang,
        url(`/help?q=${encodeURIComponent(raw)}`),
        query,
        searchHelp(index, query, lang),
      ),
    )
  }

  test('F36-AC17: Given a word, When the results are drawn, Then the count and the word are shown, with each article’s title, aim and an excerpt with the word marked', async () => {
    const ja = await search('zip')
    expect(squash(ja)).toContain(squash('zipの記事 2 件'))
    expect(ja).toContain(
      '<a href="/help/slides/accepted-files">置けるファイルの形を確かめる</a>',
    )
    expect(squash(ja)).toContain(
      squash('<span class="help-aim-name">スライドを置く・直す</span>'),
    )
    expect(ja).toMatch(/<mark>zip<\/mark>/i)
    expect(ja).toContain('value="zip"')
  })

  test('F36-AC17: Given an English screen, When the results are drawn, Then the count is in English and the English text is the excerpt’s', async () => {
    const en = await search('zip', 'en')
    expect(squash(en)).toContain(squash('articles for “zip”'))
    expect(en).toContain('<p lang="en">')
    expect(main(en)).not.toMatch(/[぀-ヿ一-鿿]/)
  })

  test('F36-AC18: Given a word no article holds, When the results are drawn, Then it says there is none, lists the aims and shows the way to ask', async () => {
    const ja = await search('まったく無い言葉xyz')
    expect(ja).toContain(
      'まったく無い言葉xyzに合う記事は見つかりませんでした。',
    )
    for (const aim of HELP_AIMS) expect(ja).toContain(`href="/help/${aim}"`)
    expect(ja).toContain('<a href="/contact">お問い合わせ</a>')
    expect(ja).not.toContain('の記事 0 件')
  })

  test('F36-AC18: Given a word with nothing to look for, When the results are drawn, Then it still says there is none', async () => {
    expect(await search('???')).toContain(
      '???に合う記事は見つかりませんでした。',
    )
  })

  test.each([
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    '</mark><b>x</b>',
    "'onfocus='alert(1)",
  ])(
    'F36-AC21: Given the word %j, When the results are drawn, Then it is text in the page, in the box and in the message, and no element comes of it',
    async (raw) => {
      const ja = await search(raw)
      const body = /<main[\s\S]*<\/main>/.exec(ja)![0]
      expect(body).not.toMatch(/<script/i)
      expect(body).not.toMatch(/<img src=x/i)
      expect(body).not.toContain('<b>x</b>')
      expect(body).not.toContain("'onfocus='")
      expect(body).toContain('に合う記事は見つかりませんでした。')
      // The value of the box is one attribute whole.
      expect(/value="([^"]*)"/.exec(body)![1]).not.toMatch(/["<>]/)
    },
  )

  test('F36-AC21: Given a word that is markup in an article’s own text, When the results are drawn, Then the excerpt shows it as text and marks it', async () => {
    const ja = await search('<title>')
    expect(ja).toContain('<mark>&lt;title&gt;</mark>')
    expect(ja).not.toContain('<mark><title>')
  })

  test('F36-AC22: Given the results, When the page is drawn, Then it asks search engines not to list it', async () => {
    expect(await search('zip')).toContain(
      '<meta name="robots" content="noindex" />',
    )
  })

  test('F36-AC20: Given a word far over the limit, When the results are drawn, Then the page is drawn and the box keeps only what the limit allows', async () => {
    const ja = await search('あ'.repeat(5_000))
    expect(ja).toContain('に合う記事は見つかりませんでした。')
    expect(/value="([^"]*)"/.exec(ja)![1]!.length).toBe(64)
  })
})

describe('the policy of the help’s pages', () => {
  test('F36-AC1: Given the policy of the entrance and the results, When it is read, Then the search form may send to the help itself and nowhere else, and the rest is the plain page’s', () => {
    expect(HELP_SEARCH_PAGE_POLICY).toContain("form-action 'self'")
    expect(HELP_SEARCH_PAGE_POLICY).not.toContain("form-action 'none'")
    expect(HELP_SEARCH_PAGE_POLICY).toContain("default-src 'none'")
    expect(HELP_SEARCH_PAGE_POLICY).toContain("frame-ancestors 'none'")
  })

  test('F36-AC29: Given the policy of the lists and the articles, When it is read, Then it allows no form, so a move to and from the terms stays in the frame', () => {
    expect(HELP_PAGE_POLICY).toContain("form-action 'none'")
    expect(HELP_PAGE_POLICY).not.toContain("'self'; base-uri")
  })
})
