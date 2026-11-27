import { describe, expect, test } from 'vitest'
import { LANGS } from '../site/i18n'
import { findArticle } from './catalog'
import { HELP_CATALOG } from './default-catalog'
import { helpNumbers } from './numbers'
import { plainText } from './search'

const article = findArticle(HELP_CATALOG, 'slides', 'accepted-files')

describe('the article on the files you can put up', () => {
  test.each(LANGS)(
    'F22-AC53: Given the article in %s, When it is read, Then it says _redirects and _headers are not put up and that their redirects and headers do not work',
    async (lang) => {
      const text = article?.article[lang]
      const body = plainText(String(await text?.body(helpNumbers())))

      expect(body).toContain('_redirects')
      expect(body).toContain('_headers')
      expect(body).toMatch(
        lang === 'ja'
          ? /転送とヘッダー.*働きません/u
          : /not act on|do not work/u,
      )
    },
  )
})
