import { readFileSync } from 'node:fs'
import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { welcomePage } from '../auth/login-pages'
import { isDraft } from '../legal/document'
import {
  DRAFT_NOTICE,
  DRAFT_SUFFIX,
  JAPANESE_ONLY_NOTICE,
} from '../legal/document-pages'
import {
  LEGAL_TEXT_KINDS,
  LEGAL_TEXT_PATHS,
  LEGAL_TEXTS,
} from '../legal/documents'
import { testEnv, TEST_ORIGIN } from '../publication/test-support'
import { CONTACT_ADDRESS, LEGAL_PAGE_POLICY } from './legal-pages'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
afterAll(() => platform.dispose())

const get = (path: string, target: Env = env) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`), target)

const HANDED_OVER = {
  terms: 'terms.md',
  privacy: 'privacy.md',
  external: 'external-transmission.md',
} as const

/** The characters a reader of the page gets from the legal text, no spaces. */
const textOf = (page: string) => {
  const region = /<div class="legal"[\s\S]*?<\/main>/u.exec(page)?.[0] ?? ''
  return (
    region
      .replace(/<style>[\s\S]*?<\/style>/gu, '')
      // A narrow screen repeats each column heading in front of its cell.
      .replace(/<span class="cell-label">[\s\S]*?<\/span\s*>/gu, '')
      .replace(/<[^>]*>/gu, '')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&amp;', '&')
      .replace(/\s+/gu, '')
  )
}

/** The addresses the handed-over Markdown links to, in its order. */
const markdownLinks = (file: string) =>
  [
    ...readFileSync(
      new URL(`../legal/handed-over/${file}`, import.meta.url),
      'utf8',
    ).matchAll(/\]\((https?:[^)]+)\)/gu),
  ].map((match) => match[1])

/** The characters of the handed-over Markdown without its marks and spaces. */
const markdownText = (file: string) =>
  readFileSync(new URL(`../legal/handed-over/${file}`, import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => !/^\|[\s|-]+\|$/u.test(line))
    .map((line) =>
      line
        .replace(/^#+ /u, '')
        .replace(/^( {4})?\d+\. /u, '')
        .replace(/^- /u, '')
        .replace(/^\| | \|$/gu, '')
        .replaceAll(' | ', '')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/gu, '$1'),
    )
    .join('')
    .replace(/\s+/gu, '')

test.each(LEGAL_TEXT_KINDS)(
  'F34-AC1, F34-AC2, F34-AC3: Given the %s page, When it is requested, Then it opens with the plain policy and the text of the handed-over Markdown, character for character',
  async (kind) => {
    const response = await get(LEGAL_TEXT_PATHS[kind])
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Security-Policy')).toBe(
      LEGAL_PAGE_POLICY,
    )
    const page = await response.text()
    // The page adds the mark of a draft and its notice, the link back to the
    // privacy policy, and, for the page whose handed-over text has none, a
    // supplement. What is left is the text of the Markdown, all of it.
    const drawn = textOf(page)
      .replace(DRAFT_SUFFIX, '')
      .replace(DRAFT_NOTICE, '')
      .replace('プライバシーポリシーへ戻る', '')
    const expected = markdownText(HANDED_OVER[kind])
    for (const url of markdownLinks(HANDED_OVER[kind]))
      expect(page).toContain(`href="${url}"`)
    const supplement = /附則.*$/u
    if (kind === 'external')
      expect(drawn.replace(supplement, '')).toBe(expected)
    else expect(drawn).toBe(expected)
  },
)

test.each(LEGAL_TEXT_KINDS)(
  'F34-AC7, F34-AC8, F34-AC9, F34-AC10, F34-AC11: Given the %s page, When it is requested, Then it is a draft with a notice and noindex exactly when its date is not a date',
  async (kind) => {
    const response = await get(LEGAL_TEXT_PATHS[kind])
    const page = await response.text()
    const draft = isDraft(LEGAL_TEXTS[kind])
    expect(page.includes(DRAFT_SUFFIX)).toBe(draft)
    expect(page.includes(DRAFT_NOTICE)).toBe(draft)
    expect(response.headers.get('X-Robots-Tag')).toBe(
      draft ? 'noindex, nofollow' : null,
    )
  },
)

test.each(LEGAL_TEXT_KINDS)(
  'F34-AC15, F34-AC16: Given the %s page, When the screen is English or Japanese, Then the English line is there only on the English screen',
  async (kind) => {
    const english = await (
      await get(`${LEGAL_TEXT_PATHS[kind]}?lang=en`)
    ).text()
    const japanese = await (await get(LEGAL_TEXT_PATHS[kind])).text()
    expect(english).toContain(JAPANESE_ONLY_NOTICE)
    expect(english).toContain('<html lang="en">')
    const bare = (page: string) =>
      textOf(page)
        .replace(JAPANESE_ONLY_NOTICE.replace(/\s+/gu, ''), '')
        .replace('プライバシーポリシーへ戻る', '')
        .replace('BacktothePrivacyPolicy', '')
    expect(bare(english)).toBe(bare(japanese))
    expect(japanese).not.toContain(JAPANESE_ONLY_NOTICE)
  },
)

test('F34-AC4: Given the terms and the privacy policy, When they are requested, Then every article heading has an id', async () => {
  for (const kind of ['terms', 'privacy'] as const) {
    const page = await (await get(LEGAL_TEXT_PATHS[kind])).text()
    const text = LEGAL_TEXTS[kind]
    if (text.form !== 'articles') throw new Error('articles expected')
    for (const article of text.articles)
      expect(page).toContain(
        `<h2 id="article-${article.number}">第 ${article.number} 条(`,
      )
    expect(page).toContain('<h2 id="supplement">附則</h2>')
  }
})

test('F34-AC17: Given the privacy policy, When it is requested, Then the words 「外部への送信」 in article 6 link to /privacy/external, and no other words there do', async () => {
  const page = await (await get('/privacy')).text()
  expect(page).toContain('<a href="/privacy/external">「外部への送信」</a>')
  const article6 =
    /<h2 id="article-6">[\s\S]*?<\/section>/u.exec(page)?.[0] ?? ''
  expect(article6.match(/<a /gu)).toHaveLength(1)
  expect(
    (/<div class="legal"[\s\S]*<\/main>/u.exec(page)?.[0] ?? '').match(/<a /gu),
  ).toHaveLength(1)
})

test('F34-AC18: Given the page "External transmission", When it is requested, Then it links back to the privacy policy and each policy of a destination is the link the text names', async () => {
  const page = await (await get('/privacy/external')).text()
  expect(page).toContain('href="/privacy"')
  expect(page).toContain('href="https://www.cloudflare.com/privacypolicy/"')
  expect(page).toContain('href="https://automattic.com/privacy/"')
  expect(page).toContain('class="data-table legal-table"')
})

test.each([
  ['/terms', '利用規約'],
  ['/privacy', 'プライバシーポリシー'],
  ['/privacy/external', '外部への送信'],
])(
  'F34-AC24: Given %s, When it is requested, Then it opens as that page and is not taken by a handle or a community',
  async (path, title) => {
    const response = await get(path)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain(`<h1>${title}`)
  },
)

test('F34-AC24: Given a path under the privacy page that is not a text, When it is requested, Then it is not found', async () => {
  expect((await get('/privacy/other')).status).toBe(404)
  expect((await get('/privacy/external/x')).status).toBe(404)
})

test.each(['/terms', '/privacy', '/privacy/external'])(
  'F34-AC23: Given maintenance, When %s is requested, Then it is still served',
  async (path) => {
    const response = await get(path, { ...env, MAINTENANCE: 'on' } as Env)
    expect(response.status).toBe(200)
    expect(
      await (
        await get('/my/slides', { ...env, MAINTENANCE: 'on' } as Env)
      ).status,
    ).toBe(503)
  },
)

test('F34-AC25: Given the welcome page, When its agreement words are followed, Then /terms and /privacy are the pages of the texts', async () => {
  const welcome = String(
    welcomePage('ja', new URL(`${TEST_ORIGIN}/welcome`), { carry: {} }),
  )
  const hrefs = [
    ...welcome.matchAll(/<a class="terms-link" href="([^"]+)">/gu),
  ].map((match) => match[1])
  expect(hrefs).toEqual(['/terms', '/privacy'])
  const titles = await Promise.all(
    hrefs.map(async (href) => {
      const page = await (await get(href ?? '')).text()
      return /<h1>([^<]*)<\/h1>/u.exec(page)?.[1]
    }),
  )
  expect(titles.map((title) => title?.replace(DRAFT_SUFFIX, ''))).toEqual([
    '利用規約',
    'プライバシーポリシー',
  ])
})

test.each([
  '/',
  '/uploads/x',
  '/my/slides',
  '/missing',
  '/terms',
  '/privacy/external',
])(
  'Given a service page, When %s is requested, Then its footer links to the help and every legal page',
  async (path) => {
    const page = await (await get(path)).text()
    for (const link of ['/help', '/terms', '/privacy', '/contact'])
      expect(page).toContain(`href="${link}"`)
  },
)

test('F34-AC26: Given any legal page or the contact page, When it is requested, Then the placeholder wording is gone', async () => {
  for (const path of ['/terms', '/privacy', '/privacy/external', '/contact']) {
    const page = await (await get(path)).text()
    for (const gone of [
      '載せる予定の内容',
      'Planned contents',
      'このページは仮のものです',
      'This page is a placeholder',
      '（仮）',
      'class="notice-warning"',
    ])
      expect(page, `${path} has ${gone}`).not.toContain(gone)
  }
})

test.each([
  ['/contact', 'お問い合わせは、次のメールアドレスへお送りください。'],
  ['/contact?lang=en', 'Please send inquiries to this email address.'],
])(
  'F34-AC27, F17-AC24: Given %s, When it is requested, Then the address is shown as selectable text, the title has no placeholder mark and the page is still not listed',
  async (path, lead) => {
    const response = await get(path)
    const page = await response.text()
    expect(page).toContain(lead)
    expect(page).toContain(`>${CONTACT_ADDRESS}</a>`)
    expect(page).toContain(`href="mailto:${CONTACT_ADDRESS}"`)
    expect(page).toMatch(/<h1>(お問い合わせ|Contact)<\/h1>/u)
    expect(page).not.toContain('準備中')
    expect(page).not.toContain('not taking inquiries')
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  },
)

test.each(['/terms', '/privacy', '/privacy/external'])(
  'F17-AC24: Given %s, When it is requested, Then it does not show the contact address',
  async (path) => {
    expect(await (await get(path)).text()).not.toContain(CONTACT_ADDRESS)
  },
)
