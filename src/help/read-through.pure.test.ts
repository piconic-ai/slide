import { describe, expect, test } from 'vitest'
import { LANGS, type Lang } from '../site/i18n'
import { MAX_TERM_CHARS, searchTermOf } from '../metrics/term'
import { parseNewAuthorLimits } from '../uploads/new-author-limits'
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

describe('the limit on new slides of a new account', () => {
  const limits = parseNewAuthorLimits({})

  test.each(['slides/limits', 'slides/upload'])(
    'F36-AC51: Given %s in each language, When it is read, Then it states the days, the hours and the number of the code, and leads to the article on the limit',
    async (key) => {
      for (const lang of LANGS) {
        const { body, bodyHtml } = await render(key, lang)
        for (const figure of [
          limits.days,
          limits.perDay,
          numbers.newAuthorWindowHours,
        ])
          expect(body, `${key} ${lang}`).toContain(String(figure))
        expect(bodyHtml).toContain('href="/help/slides/daily-limit"')
      }
    },
  )

  test.each(['slides/limits', 'slides/upload'])(
    'F36-AC51: Given %s, When its related articles are read, Then the article on the limit is one of them and there are still at most three',
    async (key) => {
      const { related } = await render(key, 'ja')
      expect(related).toContain('slides/daily-limit')
      expect(related.length).toBeLessThanOrEqual(3)
    },
  )

  test('F36-AC51: Given a replaced version, When the article on putting up slides is read, Then it says a replacement does not count, as the article on the limit does', async () => {
    const ja = await render('slides/upload', 'ja')
    expect(ja.body).toContain('差し替えは、数えません')
    const en = await render('slides/upload', 'en')
    expect(en.body).toContain('does not count')
  })
})

describe('the sign-up article and the article on asking the operator', () => {
  const limits = parseNewAuthorLimits({})

  test('F36-AC52: Given the sign-up article in each language, When it is read, Then it states the limit of a new account with the code’s numbers and leads to the article on it', async () => {
    for (const lang of LANGS) {
      const { body, bodyHtml } = await render('start/sign-up', lang)
      for (const figure of [
        limits.days,
        limits.perDay,
        numbers.newAuthorWindowHours,
      ])
        expect(body, lang).toContain(String(figure))
      expect(bodyHtml).toContain('href="/help/slides/daily-limit"')
    }
  })

  test('F36-AC52: Given the sign-up article, When it says the handle cannot be changed, Then it says you cannot yourself and that the operator can be asked, with the link', async () => {
    const ja = await render('start/sign-up', 'ja')
    expect(ja.body).toContain('自分ではあとから変えられません')
    expect(ja.body).toContain('運営に頼めます')
    expect(ja.bodyHtml).toContain('href="/help/community/ask-us"')
    const en = await render('start/sign-up', 'en')
    expect(en.body).toContain('cannot change the handle yourself')
    expect(en.body).toContain('ask the operator')
    expect(en.bodyHtml).toContain('href="/help/community/ask-us"')
  })

  test('F36-AC52: Given the article on asking the operator, When it speaks of a handle, Then it says whose: your own, or that of a community you manage', async () => {
    const ja = await render('community/ask-us', 'ja')
    expect(ja.body).toContain(
      '自分のハンドルか、自分が管理者のコミュニティのハンドル',
    )
    const en = await render('community/ask-us', 'en')
    expect(en.body).toContain('your own handle')
    expect(en.body).toContain('a community you manage')
  })
})

describe('the article on the information we keep', () => {
  test('F36-AC53: Given the article in each language, When it speaks of the help search, Then it says a search that found nothing is recorded, cut to the length the code keeps, and not one that found something', async () => {
    const ja = await render('safety/data-we-keep', 'ja')
    expect(ja.body).toContain('0 件だった語')
    expect(ja.body).toContain(`${MAX_TERM_CHARS} 文字までに切って記録`)
    expect(ja.body).toContain('合う記事があった検索の語は、記録しません')
    const en = await render('safety/data-we-keep', 'en')
    expect(en.body).toContain('finds no article')
    expect(en.body).toContain(`cut to ${MAX_TERM_CHARS} characters`)
    expect(en.body).toContain('finds an article are not recorded')
  })

  test('F36-AC53: Given the article, When it says what is not recorded, Then it names the forms of word the code refuses and says that no person is recorded', async () => {
    const ja = await render('safety/data-we-keep', 'ja')
    expect(ja.body).toContain('メールアドレス、IP アドレス')
    expect(ja.body).toContain('だれが探したかは、記録しません')
    const en = await render('safety/data-we-keep', 'en')
    expect(en.body).toContain('look like an email address, an IP address')
    expect(en.body).toContain('Who searched is not recorded')
  })

  test('F36-AC53: Given the words the article says are not kept, When the code is asked, Then it refuses an address, an IP address, a web address and a key, and keeps an ordinary word', () => {
    for (const word of [
      'me@example.com',
      '192.168.0.1',
      'https://example.com',
      'abcdefghijklmnopqrstuvwxyz0123',
    ])
      expect(searchTermOf(word), word).toBeNull()
    expect(searchTermOf('zip')).toBe('zip')
  })
})
