import { afterAll, describe, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { testEnv, TEST_ORIGIN } from '../publication/test-support'
import { HELP_AIMS } from './aims'
import { HELP_CATALOG } from './default-catalog'
import { HELP_PAGE_POLICY, HELP_SEARCH_PAGE_POLICY } from './pages'
import { HELP_BOT_PAGE_POLICY } from '../site/help-bot-page'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
afterAll(() => platform.dispose())

const get = (path: string, vars: Env = env, init: RequestInit = {}) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`, init), vars)

/** A DB that fails when anything is asked of it: no page may read it. */
const noDatabase = new Proxy(
  {},
  {
    get() {
      throw new Error('the help must not read the database')
    },
  },
) as unknown as D1Database

const maintenance = {
  ...env,
  MAINTENANCE: 'on',
  DB: noDatabase,
} as Env

const everyPath = [
  '/help',
  '/help/bot',
  ...HELP_AIMS.map((aim) => `/help/${aim}`),
  ...HELP_CATALOG.map((entry) => entry.path),
]

describe('the help’s pages', () => {
  test.each(everyPath)(
    'F36-AC13: Given %s, When it is requested in Japanese and in English, Then each answers in its language with the help’s policy',
    async (path) => {
      for (const lang of ['ja', 'en'] as const) {
        const response = await get(`${path}?lang=${lang}`)
        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Security-Policy')).toBe(
          path === '/help/bot'
            ? HELP_BOT_PAGE_POLICY
            : path === '/help'
              ? HELP_SEARCH_PAGE_POLICY
              : HELP_PAGE_POLICY,
        )
        expect(await response.text()).toContain(`<html lang="${lang}">`)
      }
    },
  )

  test('F36-AC2: Given the entrance, When it is requested, Then it lists the eight aims in order, with a search box', async () => {
    const page = await (await get('/help')).text()
    expect(page).toContain('<h1>ヘルプ</h1>')
    expect(page).toContain('type="search"')
    const hrefs = [...page.matchAll(/<h2><a href="(\/help\/[a-z]+)">/g)].map(
      (match) => match[1],
    )
    expect(hrefs).toEqual(HELP_AIMS.map((aim) => `/help/${aim}`))
  })

  test('F36-AC1: Given the English entrance, When it is requested, Then the English search box and aims are shown', async () => {
    const page = await (await get('/help?lang=en')).text()
    expect(page).toContain('<h1>Help</h1>')
    expect(page).toContain('Getting started')
    expect(page).toContain('>Search</button>')
  })

  test('F36-AC6: Given an article, When it is requested, Then its title and its lead are in the page', async () => {
    const page = await (await get('/help/start/sign-in')).text()
    expect(page).toContain('<h1>ログインする</h1>')
    expect(page).toContain('aria-current="page"')
    expect(page).toContain('class="help-lead"')
    expect(page).toContain('<a href="/contact">')
  })
})

describe('what the help is, to search engines', () => {
  test.each([
    '/help',
    '/help/start',
    '/help/safety',
    '/help/start/sign-in',
    '/help/community/create-community',
    '/help/bot',
  ])(
    'F36-AC22: Given %s, When it is requested, Then it may be listed',
    async (path) => {
      const response = await get(path)
      expect(response.status).toBe(200)
      expect(response.headers.get('X-Robots-Tag')).toBeNull()
    },
  )

  test.each(['/help', '/help/start', '/help/start/sign-in'])(
    'F36-AC23: Given %s, When it is requested, Then it names the page in both languages and the default',
    async (path) => {
      const link = (await get(path)).headers.get('Link') ?? ''
      expect(link).toContain(
        `<${TEST_ORIGIN}${path}?lang=ja>; rel="alternate"; hreflang="ja"`,
      )
      expect(link).toContain(
        `<${TEST_ORIGIN}${path}?lang=en>; rel="alternate"; hreflang="en"`,
      )
      expect(link).toContain(
        `<${TEST_ORIGIN}${path}>; rel="alternate"; hreflang="x-default"`,
      )
    },
  )

  test.each([
    '/help?q=zip',
    '/help?q=%E3%83%AD%E3%82%B0%E3%82%A4%E3%83%B3',
    '/help?q=nothing-here-xyz',
    '/help?q=%3Cb%3E',
  ])(
    'F36-AC22: Given the results %s, When they are requested, Then they are not to be listed and name no other language',
    async (path) => {
      const response = await get(path)
      expect(response.status).toBe(200)
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex')
      expect(response.headers.get('Link')).toBeNull()
      expect(await response.text()).toContain(
        '<meta name="robots" content="noindex" />',
      )
    },
  )
})

describe('the search', () => {
  test('F36-AC14: Given a word, When it is searched, Then the articles that hold it are listed with the word marked', async () => {
    const page = await (await get('/help?q=zip')).text()
    expect(page).toContain('zipの記事')
    expect(page).toContain('href="/help/slides/accepted-files"')
    expect(page).toMatch(/<mark>zip<\/mark>/i)
    expect(page).toContain('value="zip"')
  })

  test('F36-AC16: Given an English screen and a Japanese word, When it is searched, Then the Japanese articles are found', async () => {
    const page = await (
      await get('/help?q=%E8%BF%B7%E6%83%91%E3%83%A1%E3%83%BC%E3%83%AB&lang=en')
    ).text()
    expect(page).toContain('href="/help/start/code-not-arrived"')
    expect(page).toContain('<p lang="ja">')
  })

  test.each([
    '/help?q=',
    '/help?q=%20%20',
    '/help?q=%E3%80%80',
    '/help',
    '/help?other=1',
  ])(
    'F36-AC19: Given %s, When it is requested, Then the entrance is shown, not a result',
    async (path) => {
      const response = await get(path)
      expect(response.status).toBe(200)
      expect(response.headers.get('X-Robots-Tag')).toBeNull()
      const page = await response.text()
      expect(page).toContain('href="/help/safety"')
      expect(page).not.toContain('見つかりませんでした')
      expect(page).not.toContain('class="help-entries"')
    },
  )

  test('F36-AC18: Given a word no article holds, When it is searched, Then the page says so with the aims and the way to ask', async () => {
    const page = await (await get('/help?q=zzzz-no-such-word')).text()
    expect(page).toContain(
      'zzzz-no-such-wordに合う記事は見つかりませんでした。',
    )
    expect(page).toContain('href="/help/start"')
    expect(page).toContain('<a href="/contact">お問い合わせ</a>')
  })

  test('F36-AC20: Given a word far over the limit, When it is searched, Then the results page is shown, not an error', async () => {
    const response = await get(`/help?q=${'a'.repeat(200_000)}`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain(
      'に合う記事は見つかりませんでした。',
    )
  })

  test('F36-AC20: Given many words and a symbol only, When they are searched, Then the results page is shown', async () => {
    for (const q of [
      '!!!',
      '%3F',
      'a%20b%20c%20d%20e%20f%20g%20h',
      '%F0%9F%98%80',
    ])
      expect((await get(`/help?q=${q}`)).status).toBe(200)
  })

  test('F36-AC21: Given a word with markup, When it is searched, Then the page holds it as text and no script of the word runs', async () => {
    const page = await (
      await get(`/help?q=${encodeURIComponent('<script>alert(1)</script>')}`)
    ).text()
    expect(page).not.toContain('<script>alert(1)')
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  test('F36-AC21: Given a word that is markup in an article, When it is searched, Then the excerpt marks it as text', async () => {
    const page = await (
      await get(`/help?q=${encodeURIComponent('<title>')}`)
    ).text()
    expect(page).toContain('<mark>&lt;title&gt;</mark>')
  })

  test('F36-AC27: Given someone who comes by an old link to a section, When the help is requested, Then the entrance opens', async () => {
    // The fragment never reaches the server; the request is the entrance's.
    const response = await get('/help#login')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('href="/help/start"')
  })
})

describe('what is not there', () => {
  test.each([
    '/help/missing',
    '/help/start/missing',
    '/help/start/sign-in/extra',
    '/help/bot/anything',
    '/help/START',
    '/help/start/SIGN-IN',
    '/help/__proto__',
    '/help/start/__proto__',
    '/help/start/constructor',
  ])(
    'F36-AC25: Given %s, When it is requested, Then it is not found and not to be listed',
    async (path) => {
      const response = await get(path)
      expect(response.status).toBe(404)
      expect(response.headers.get('X-Robots-Tag')).toContain('noindex')
    },
  )

  test('F36-AC25: Given the bot’s path and an aim’s, When they are requested, Then the bot is its own page and the aim is its own', async () => {
    expect(await (await get('/help/bot')).text()).toContain(
      '<h1>配信を読むボット</h1>',
    )
    expect(await (await get('/help/safety')).text()).toContain(
      '<h1>安全と規約</h1>',
    )
  })
})

describe('the page on the bot', () => {
  test.each([
    ['/help/bot', '<html lang="ja">', '<h1>配信を読むボット</h1>'],
    ['/help/bot?lang=en', '<html lang="en">', '<h1>The feed-reading bot</h1>'],
  ])(
    'F36-AC24: Given %s, When it is requested, Then it opens as before, may be listed and links to the contact page',
    async (path, lang, heading) => {
      const response = await get(path)
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Security-Policy')).toBe(
        HELP_BOT_PAGE_POLICY,
      )
      expect(response.headers.get('X-Robots-Tag')).toBeNull()
      const page = await response.text()
      expect(page).toContain(lang)
      expect(page).toContain(heading)
      expect(page).toContain('<a href="/contact">')
    },
  )

  test.each([
    ['/help/safety', '配信を読むボット'],
    ['/help/safety?lang=en', 'The feed-reading bot'],
  ])(
    'F36-AC24: Given the list of the safety aim %s, When it is read, Then it links to the page on the bot, which opens',
    async (path, label) => {
      const page = await (await get(path)).text()
      expect(page).toContain(`<a href="/help/bot">${label}</a>`)
      expect((await get('/help/bot')).status).toBe(200)
    },
  )
})

describe('maintenance', () => {
  test.each([
    ...everyPath,
    '/help?q=zip',
    '/help?q=nothing-here-xyz',
    '/help?q=',
  ])(
    'F36-AC28: Given maintenance and no database, When %s is requested, Then it is served and the database is not touched',
    async (path) => {
      const response = await get(path, maintenance)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('<main')
    },
  )

  test('F36-AC28: Given maintenance, When a page the help does not hold is requested, Then it is the maintenance page, so the help’s freedom is its own', async () => {
    expect((await get('/', maintenance)).status).toBe(503)
  })
})
