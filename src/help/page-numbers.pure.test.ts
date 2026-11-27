import { describe, expect, test } from 'vitest'
import { LANGS } from '../site/i18n'
import { findArticle } from './catalog'
import { HELP_CATALOG } from './default-catalog'
import { helpNumbers } from './numbers'
import { plainText } from './search'

describe('the article on page numbers', () => {
  test.each(LANGS)(
    'F03-AC191: Given the article in %s, When it is read, Then it states the known limits of Slidev and of reveal.js loaded as an ES module, with the browsers they were seen in',
    async (lang) => {
      const text = findArticle(HELP_CATALOG, 'sharing', 'page-numbers')
        ?.article[lang]
      const body = plainText(String(await text?.body(helpNumbers())))

      expect(body).toContain('Slidev')
      expect(body).toContain('Chromium')
      expect(body).toContain('WebKit')
      expect(body).toContain('reveal.js')
      expect(body).toContain('ES module')
    },
  )
})
