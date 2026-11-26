import { describe, expect, test } from 'vitest'
import { LANGS, type Lang } from '../site/i18n'
import { HELP_CATALOG } from './default-catalog'
import { isHelpPath } from './catalog'
import { helpNumbers } from './numbers'
import { plainText } from './search'

const numbers = helpNumbers()
const JAPANESE = /[぀-ヿ一-鿿]/

/** What an article says in one language: its title, lead and body as markup. */
async function parts(entry: (typeof HELP_CATALOG)[number], lang: Lang) {
  const text = entry.article[lang]
  const [lead, body] = await Promise.all([
    text.lead(numbers),
    text.body(numbers),
  ])
  return { title: text.title, lead: String(lead), body: String(body) }
}

describe.each(HELP_CATALOG.map((entry) => [entry.key, entry] as const))(
  '%s',
  (_, entry) => {
    test.each(LANGS)(
      'F36-AC8: Given the article in %s, When it is read, Then the title is the thing to do, and the lead is one sentence that answers',
      async (lang) => {
        const { title, lead } = await parts(entry, lang)
        expect(title.trim()).toBe(title)
        expect(title.length).toBeGreaterThan(0)
        expect(title.length).toBeLessThanOrEqual(lang === 'ja' ? 40 : 80)
        const sentence = plainText(lead)
        if (lang === 'ja') {
          expect(sentence.endsWith('。')).toBe(true)
          expect(sentence.slice(0, -1)).not.toContain('。')
        } else {
          expect(sentence).toMatch(/[.!?]$/u)
          expect(sentence.slice(0, -1)).not.toMatch(/[.!?]\s/u)
        }
        expect(lead).not.toMatch(/<(?:p|ul|ol|h\d)[\s>]/u)
      },
    )

    test.each(LANGS)(
      'F36-AC8: Given the article in %s, When its body is read, Then it has no h1 or h3 and a how-to has numbered steps',
      async (lang) => {
        const { body } = await parts(entry, lang)
        expect(body).not.toMatch(/<h[13456][\s>]/u)
        if (entry.article.form === 'howto') expect(body).toMatch(/<ol[\s>]/u)
        else expect(body.length).toBeGreaterThan(0)
      },
    )

    test('F36-AC13: Given the article, When it is read in each language, Then English holds no Japanese and Japanese does', async () => {
      const en = await parts(entry, 'en')
      expect(`${en.title}${en.lead}${en.body}`).not.toMatch(JAPANESE)
      const ja = await parts(entry, 'ja')
      expect(ja.title).toMatch(JAPANESE)
    })

    test('F36-AC48: Given the article, When its links into the help are read, Then each is an article, an aim, the bot or the entrance, and none is a section’s place', async () => {
      for (const lang of LANGS) {
        const { lead, body } = await parts(entry, lang)
        const hrefs = [...`${lead}${body}`.matchAll(/href="([^"]*)"/gu)].map(
          (match) => match[1]!,
        )
        for (const href of hrefs.filter((href) => href.startsWith('/help')))
          expect(isHelpPath(HELP_CATALOG, href)).toBe(true)
        expect(`${lead}${body}`).not.toContain('/help#')
      }
    })

    test('F36-AC11: Given the article, When it is rendered, Then no figure is left as an unfilled placeholder', async () => {
      for (const lang of LANGS) {
        const { title, lead, body } = await parts(entry, lang)
        for (const text of [title, lead, body]) {
          expect(text).not.toContain('${')
          expect(text).not.toContain('undefined')
          expect(text).not.toContain('NaN')
        }
      }
    })
  },
)
