import { describe, expect, test } from 'vitest'
import type { Lang } from '../site/i18n'
import type { HelpAim } from './aims'
import { findArticle } from './catalog'
import { HELP_CATALOG } from './default-catalog'
import { helpNumbers } from './numbers'
import { plainText } from './search'

const numbers = helpNumbers()

/** One article's lead and body in one language, as plain text and as markup. */
const render = async (key: string, lang: Lang) => {
  const [aim, slug] = key.split('/') as [HelpAim, string]
  const entry = findArticle(HELP_CATALOG, aim, slug)
  if (!entry) throw new Error(`no article ${key}`)
  const text = entry.article[lang]
  const [lead, body] = await Promise.all([
    text.lead(numbers),
    text.body(numbers),
  ])
  return {
    related: entry.article.related,
    lead: plainText(String(lead)),
    leadHtml: String(lead),
    body: plainText(String(body)),
    bodyHtml: String(body),
  }
}

describe('the article on publishing an article', () => {
  test('F36-AC8: Given the article in each language, When its lead is read, Then it names the button that publishes and the one that stops, as the title asks', async () => {
    const ja = await render('articles/publish', 'ja')
    expect(ja.lead).toContain('「記事を公開する」')
    expect(ja.lead).toContain('「記事の公開を止める」')
    const en = await render('articles/publish', 'en')
    expect(en.lead).toContain('“Publish the article”')
    expect(en.lead).toContain('“Stop publishing the article”')
  })

  test('F36-AC8: Given the English article, When it says what is published, Then it is the saved text and not the box on the edit page', async () => {
    const en = await render('articles/publish', 'en')
    expect(en.body).toContain('the text that was saved')
    expect(en.body).not.toContain('what is kept is published')
  })
})
