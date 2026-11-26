import { describe, expect, test } from 'vitest'
import { findArticle } from '../help/catalog'
import { HELP_CATALOG } from '../help/default-catalog'
import { helpNumbers } from '../help/numbers'
import { LANGS } from '../site/i18n'
import { OFFLINE_MAX_AGE_MS, OFFLINE_MAX_VERSIONS } from './limits'
import { offlineShell, storedBandSlot } from './shell-pages'

describe('the band of a stored version leads to its article', () => {
  test.each(LANGS)(
    'F36-AC32: Given the band in %s, When it is drawn, Then it holds one link to the article on stored versions, which exists, and the link is tall enough to press',
    async (lang) => {
      const band = String(await storedBandSlot(lang))
      expect(band.match(/href="\/help\/[^"]*"/g)).toEqual([
        'href="/help/sharing/stored-version"',
      ])
      expect(band).toContain('class="viewer-notice-help"')
      expect(
        findArticle(HELP_CATALOG, 'sharing', 'stored-version'),
      ).not.toBeNull()
    },
  )

  test('F36-AC32: Given the limits of the offline reading, When the articles quote them, Then they are the code’s: one day and twenty slides', async () => {
    const n = helpNumbers()
    expect(n.offlineDays * 86_400_000).toBe(OFFLINE_MAX_AGE_MS)
    expect(n.offlineSlides).toBe(OFFLINE_MAX_VERSIONS)
    for (const lang of LANGS) {
      const entry = findArticle(HELP_CATALOG, 'sharing', 'read-offline')!
      const text = String(await entry.article[lang].body(n))
      expect(text).toContain(String(OFFLINE_MAX_VERSIONS))
    }
  })

  test.each(LANGS)(
    'F37-AC14: Given the kept shell in %s, When it is drawn, Then its links take the ink color of the text, not the browser’s blue',
    async (lang) => {
      const shell = String(
        await offlineShell(
          {
            title: 'Talk',
            contentOrigin: 'https://d-1.content.example',
            contentBase: 'https://content.example',
          },
          lang,
        ),
      )
      expect(shell).toMatch(/\sa\s*\{\s*color:\s*inherit;\s*\}/)
    },
  )
})
