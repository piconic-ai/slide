import { describe, expect, test } from 'vitest'
import { articleId } from '../legal/document'
import { LEGAL_TEXTS } from '../legal/documents'
import { EXPORT_SLIDES_PER_PAGE } from '../exports/list-view'
import { MAX_ZIP_BYTES, MAX_ZIP_FILES } from '../exports/zip-plan'
import { FILE_URL_SECONDS } from '../mcp/file-url'
import { FILES_PAGE_SIZE } from '../mcp/files-page'
import { maintenanceHelpPath } from '../maintenance/help-link'
import { LANGS, type Lang } from '../site/i18n'
import { articlesOfAim, findArticle } from './catalog'
import { HELP_CATALOG } from './default-catalog'
import {
  legalArticle,
  legalHref,
  legalIsDraft,
  legalItems,
  PRIVACY_KEEPING,
  PRIVACY_REQUESTS,
  PROHIBITED_ITEMS_EN,
  TERMS_HIDING,
  TERMS_LEAVING,
  TERMS_PROHIBITED,
  TERMS_TAKING_OUT,
} from './legal-links'
import { helpNumbers } from './numbers'
import { plainText } from './search'
import type { HelpAim } from './aims'

const numbers = helpNumbers()

/** The article's title, lead and body in one language, as one string. */
const render = async (key: string, lang: Lang) => {
  const [aim, slug] = key.split('/') as [HelpAim, string]
  const entry = findArticle(HELP_CATALOG, aim, slug)
  if (!entry) throw new Error(`no article ${key}`)
  const text = entry.article[lang]
  const [lead, body] = await Promise.all([
    text.lead(numbers),
    text.body(numbers),
  ])
  return { title: text.title, lead: String(lead), body: String(body) }
}

const titlesOf = (aim: HelpAim, lang: Lang) =>
  articlesOfAim(HELP_CATALOG, aim).map((entry) => entry.article[lang].title)

describe('the articles for the features of the fourth scope are in their aims’ lists, in both languages', () => {
  test.each([
    [
      'F36-AC30',
      'account',
      [
        'スライドを zip で受け取る',
        'すべてのデータを書き出す',
        '書き出した zip を置き直す',
        '退会する前にデータを残す',
      ],
    ],
    [
      'F36-AC31',
      'agent',
      ['AI エージェントに全部を書き出してもらう', '接続をつなぎ直す'],
    ],
    ['F36-AC33', 'safety', ['メンテナンス中です、と出たとき']],
    ['F36-AC36', 'start', ['登録する', 'ログインのコードが届かないとき']],
    [
      'F36-AC34',
      'safety',
      [
        '禁止されていること',
        'スライドが非表示になったとき',
        '非表示や利用の停止に異議を申し立てる',
      ],
    ],
    [
      'F36-AC35',
      'safety',
      ['運営者と連絡先', '預かっている情報と、その守り方'],
    ],
  ] as const)(
    '%s: Given the %s list, When it is read, Then the titles are in it, and each is read in English too',
    (_, aim, titles) => {
      const ja = titlesOf(aim, 'ja')
      for (const title of titles) expect(ja).toContain(title)
      const en = titlesOf(aim, 'en')
      expect(en.length).toBe(ja.length)
      for (const title of en) expect(title.length).toBeGreaterThan(0)
    },
  )

  test('F36-AC33: Given the band of a coming maintenance, When it picks where to lead, Then the article on maintenance is there for it to reach', () => {
    expect(maintenanceHelpPath(HELP_CATALOG)).toBe('/help/safety/maintenance')
  })
})

describe('the articles of safety and terms follow the terms of service in their words', () => {
  test('F36-AC38: Given the terms, When the help names an article by its title, Then the terms have it, and the link reaches its place by its id', () => {
    for (const title of [
      TERMS_PROHIBITED,
      TERMS_HIDING,
      TERMS_LEAVING,
      TERMS_TAKING_OUT,
    ]) {
      const article = legalArticle('terms', title)
      expect(article, title).not.toBeNull()
      expect(legalHref('terms', title)).toBe(`/terms#${articleId(article!)}`)
    }
    for (const title of [PRIVACY_KEEPING, PRIVACY_REQUESTS]) {
      const article = legalArticle('privacy', title)
      expect(article, title).not.toBeNull()
      expect(legalHref('privacy', title)).toBe(
        `/privacy#${articleId(article!)}`,
      )
    }
  })

  test('F36-AC38: Given a title the terms do not have, When the link is made, Then it leads to the text’s page and not to a place that is not there', () => {
    expect(legalHref('terms', '無い条')).toBe('/terms')
    expect(legalItems('terms', '無い条')).toEqual([])
    expect(legalItems('terms', TERMS_HIDING)).toEqual([])
  })

  test.each([
    ['safety/prohibited', [TERMS_PROHIBITED]],
    ['safety/hidden-slide', [TERMS_HIDING, TERMS_PROHIBITED]],
    ['safety/appeal', [TERMS_HIDING]],
  ] as const)(
    'F36-AC38: Given %s, When it is read in each language, Then it links to the terms’ article by its place and names no article number',
    async (key, titles) => {
      for (const lang of LANGS) {
        const { lead, body } = await render(key, lang)
        const text = `${lead}${body}`
        for (const title of titles)
          expect(text).toContain(`href="${legalHref('terms', title)}"`)
        expect(text).not.toMatch(/第\s*\d+\s*条/u)
        expect(text).not.toMatch(/\b(?:Article|Section)\s+\d/u)
      }
    },
  )

  test('F36-AC34: Given the terms’ article on prohibited acts, When the help lists it in Japanese, Then each item is the terms’ own, in the terms’ order', async () => {
    const { body } = await render('safety/prohibited', 'ja')
    const items = legalItems('terms', TERMS_PROHIBITED)
    expect(items.length).toBeGreaterThan(0)
    const positions = items.map((item) => body.indexOf(`<li>${item}</li>`))
    expect(positions.every((at) => at >= 0)).toBe(true)
    expect(positions).toEqual([...positions].toSorted((a, b) => a - b))
  })

  test('F36-AC34: Given the English list of prohibited acts, When the terms change the number of items, Then this test says so', async () => {
    expect(PROHIBITED_ITEMS_EN.length).toBe(
      legalItems('terms', TERMS_PROHIBITED).length,
    )
    const { body } = await render('safety/prohibited', 'en')
    for (const item of PROHIBITED_ITEMS_EN)
      expect(body).toContain(`<li>${item}</li>`)
  })

  test('F36-AC34: Given the articles on hiding and on the appeal, When they say what is done and how to object, Then they use the terms’ words and send the reader to the contact page', async () => {
    const hidden = await render('safety/hidden-slide', 'ja')
    expect(hidden.body).toContain('規約に反すると判断したとき')
    expect(hidden.body).toContain('href="/help/safety/appeal"')
    const appeal = await render('safety/appeal', 'ja')
    expect(appeal.lead).toContain('異議を申し立てます')
    expect(appeal.body).toContain('「お問い合わせ」')
    expect(appeal.body).toContain('措置の理由を説明する義務を負わない')
  })

  test('F36-AC35: Given the article on what is kept, When it is read in each language, Then it leads to the privacy policy and to the external transmission page', async () => {
    for (const lang of LANGS) {
      const { lead, body } = await render('safety/data-we-keep', lang)
      const text = `${lead}${body}`
      expect(text).toContain('href="/privacy"')
      expect(text).toContain('href="/privacy/external"')
      expect(text).toContain(`href="${legalHref('privacy', PRIVACY_KEEPING)}"`)
    }
  })

  test('F36-AC35: Given the article on the operator, When it is read, Then it names the footer’s operator and leads to the contact page’s way of reaching them', async () => {
    const ja = await render('safety/operator', 'ja')
    expect(plainText(ja.lead)).toContain('運営者: kobaken')
    expect(ja.body).toContain('href="https://x.com/kfly8"')
    expect(ja.body).toContain('お問い合わせ')
    const en = await render('safety/operator', 'en')
    expect(plainText(en.lead)).toContain('Operated by kobaken')
  })

  test.each(['safety/terms', 'safety/privacy'] as const)(
    'F36-AC35: Given %s, When the text is a draft, Then the article says so, and when it is not, it does not',
    async (key) => {
      const which = key === 'safety/terms' ? 'terms' : 'privacy'
      for (const lang of LANGS) {
        const { body } = await render(key, lang)
        expect(body.includes(lang === 'ja' ? '(下書き)' : 'marks its')).toBe(
          legalIsDraft(which),
        )
        expect(body).not.toContain('仮のページ')
      }
      expect(LEGAL_TEXTS[which].form).toBe('articles')
    },
  )
})

describe('the figures of the new articles are the code’s', () => {
  test('F36-AC11: Given the export and agent articles, When they are rendered, Then their figures are the ones the code enforces', async () => {
    expect(numbers.zipFiles).toBe(MAX_ZIP_FILES)
    expect(numbers.zipMb * 1024 * 1024).toBe(MAX_ZIP_BYTES)
    expect(numbers.exportSlidesPerPage).toBe(EXPORT_SLIDES_PER_PAGE)
    expect(numbers.fileUrlMinutes * 60).toBe(FILE_URL_SECONDS)
    expect(numbers.agentFilesPerCall).toBe(FILES_PAGE_SIZE)
    for (const lang of LANGS) {
      const slide = await render('account/export-slide', lang)
      expect(slide.body).toContain(String(MAX_ZIP_FILES))
      expect(slide.body).toContain(String(MAX_ZIP_BYTES / 1024 / 1024))
      const all = await render('account/export-all', lang)
      expect(all.body).toContain(String(EXPORT_SLIDES_PER_PAGE))
      const agent = await render('agent/export-with-agent', lang)
      expect(agent.body).toContain(String(FILE_URL_SECONDS / 60))
      expect(agent.body).toContain(String(FILES_PAGE_SIZE))
    }
  })
})
