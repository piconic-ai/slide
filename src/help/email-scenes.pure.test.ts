import { afterEach, describe, expect, test, vi } from 'vitest'
import { ADDRESS_EXPOSURES, type Exposure } from '../privacy/email-exposure'
import { LANGS, type Lang } from '../site/i18n'
import { findArticle } from './catalog'
import { HELP_CATALOG } from './default-catalog'
import { helpNumbers } from './numbers'
import { plainText } from './search'
import type { Article } from './article'

// F43-AC13: the article that tells subscribers where their address is used
// draws its list from the declaration (src/privacy/email-exposure.ts), so it
// cannot say more or less than the tests hold the service to.

const numbers = helpNumbers()

const HEADING: Record<Lang, string> = {
  ja: 'メールアドレスを使う場面',
  en: 'Where your email address is used',
}

/** The items of the list that follows the article's heading about the address. */
async function itemsOf(article: Article, lang: Lang): Promise<string[]> {
  const html = String(await article[lang].body(numbers))
  const section = html
    .split('<h2>')
    .find((part) => part.startsWith(HEADING[lang]))
  if (!section) return []
  const list = section.split('</h2>')[1]!.split('</ul>')[0]!
  return [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((item) =>
    plainText(item[1]!).trim(),
  )
}

const dataWeKeep = () => {
  const entry = findArticle(HELP_CATALOG, 'safety', 'data-we-keep')
  if (!entry) throw new Error('the article is not in the catalog')
  return entry.article
}

afterEach(() => {
  vi.doUnmock('../privacy/email-exposure')
  vi.resetModules()
})

describe('F43-AC13: the article safety/data-we-keep', () => {
  test.each(LANGS)(
    'Given the declaration, When the article is read in %s, Then it lists as many scenes as the declaration has places, each in the declared words and order',
    async (lang) => {
      // Six places to begin with; the declaration may only gain more.
      expect(ADDRESS_EXPOSURES.length).toBeGreaterThanOrEqual(6)
      expect(await itemsOf(dataWeKeep(), lang)).toEqual(
        ADDRESS_EXPOSURES.map((exposure) => exposure.scene[lang]),
      )
    },
  )

  test.each(LANGS)(
    'Given a place added to the declaration, When the article is read in %s, Then the place is in it, with no change to the article',
    async (lang) => {
      const added: Exposure = {
        id: 'added',
        where: { kind: 'mail' },
        reason: 'A place added for this test.',
        scene: { ja: '足した場面です。', en: 'An added scene.' },
      }
      vi.resetModules()
      vi.doMock('../privacy/email-exposure', async (original) => {
        const real =
          await original<typeof import('../privacy/email-exposure')>()
        return {
          ...real,
          ADDRESS_EXPOSURES: [...real.ADDRESS_EXPOSURES, added],
        }
      })
      const { default: article } =
        await import('./articles/safety/data-we-keep')
      const items = await itemsOf(article, lang)
      expect(items).toHaveLength(ADDRESS_EXPOSURES.length + 1)
      expect(items.at(-1)).toBe(added.scene[lang])
    },
  )

  test.each(LANGS)(
    'Given the article in %s, When its text is read, Then no scene is written in it by hand: every sentence about an address is one of the declaration’s',
    async (lang) => {
      const article = dataWeKeep()
      const html = String(await article[lang].body(numbers))
      const outside = html.replace(
        /<h2>(メールアドレスを使う場面|Where your email address is used)<\/h2>[\s\S]*?<\/ul>/,
        '',
      )
      // The other sections point to the help on the address, and name it;
      // none of them says where it is used.
      for (const exposure of ADDRESS_EXPOSURES)
        expect(plainText(outside)).not.toContain(exposure.scene[lang])
    },
  )
})
