import { expect, test, vi } from 'vitest'
import { LANGS, type Lang } from '../site/i18n'
import { findArticle } from './catalog'
import { HELP_CATALOG } from './default-catalog'
import { helpNumbers } from './numbers'

/**
 * The carried texts have a date, so the help's note on a draft is tried on a
 * copy: the terms and the privacy policy get the blank back.
 */
vi.mock('../legal/documents', async (importOriginal) => {
  const original = await importOriginal<typeof import('../legal/documents')>()
  const blank = [{ date: '(施行日)', summary: '制定' }]
  return {
    ...original,
    LEGAL_TEXTS: {
      ...original.LEGAL_TEXTS,
      terms: { ...original.LEGAL_TEXTS.terms, history: blank },
      privacy: { ...original.LEGAL_TEXTS.privacy, history: blank },
    },
  }
})

const bodyOf = async (slug: string, lang: Lang) => {
  const entry = findArticle(HELP_CATALOG, 'safety', slug)
  if (!entry) throw new Error(`no article safety/${slug}`)
  return String(await entry.article[lang].body(helpNumbers()))
}

test.each(['terms', 'privacy'] as const)(
  'F36-AC35: Given the %s text without a date, When its help article is read in each language, Then the article says the text is a draft',
  async (slug) => {
    for (const lang of LANGS)
      expect(await bodyOf(slug, lang)).toContain(
        lang === 'ja' ? '(下書き)' : 'marks its',
      )
  },
)
