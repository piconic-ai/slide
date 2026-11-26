import { expect, test } from 'vitest'
import {
  OPERATOR_NAME,
  OPERATOR_URL,
  REPOSITORY_URL,
  siteFooter,
} from './footer'

const render = (lang: 'ja' | 'en') =>
  String(siteFooter(lang, new URL('https://slide.example/help')))

const link = (markup: string) =>
  markup.match(/<a\s[^>]*class="github-link"[\s\S]*?<\/a\s*>/)?.[0] ?? ''

test('F03-AC92: Given the footer, When it is drawn, Then the repository URL is the one constant, https://github.com/piconic-ai/slide', () => {
  expect(REPOSITORY_URL).toBe('https://github.com/piconic-ai/slide')
  expect(link(render('ja'))).toContain(`href="${REPOSITORY_URL}"`)
})

test.each([
  ['ja', 'GitHub のリポジトリ'],
  ['en', 'GitHub repository'],
] as const)(
  'F03-AC93: Given a %s page, When the footer is drawn, Then the link is named "%s" and its icon is an inline SVG hidden from readers',
  (lang, name) => {
    const markup = link(render(lang))
    expect(markup).toContain(`aria-label="${name}"`)
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"/)
    expect(markup).toContain('fill="currentColor"')
    expect(markup).toContain('viewBox="0 0 16 16"')
    // Only text-free inline markup: no image and no stylesheet is fetched.
    expect(markup).not.toMatch(/<img|<image|url\(|href="[^"]*\.svg/)
  },
)

test('F03-AC95: Given the footer, When the link is drawn, Then it opens in the same tab with rel noopener noreferrer', () => {
  const markup = link(render('ja'))
  expect(markup).toContain('rel="noopener noreferrer"')
  expect(markup).not.toContain('target=')
})

test('F03-AC93: Given the footer, When the icon is drawn, Then one comment in it keeps the Octicons copyright and MIT notice, and the name and URL are unchanged', () => {
  const markup = link(render('en'))
  expect(markup.match(/<!--/g)).toHaveLength(1)
  expect(markup).toMatch(
    /<!--[^>]*Octicons mark-github, Copyright \(c\) GitHub, Inc\., MIT License\.\s*https:\/\/github\.com\/primer\/octicons\/blob\/main\/LICENSE\s*-->/,
  )
  expect(markup).toContain('aria-label="GitHub repository"')
  expect(markup).toContain(`href="${REPOSITORY_URL}"`)
})

const operator = (markup: string) =>
  markup.match(/<span class="operator"[\s\S]*?<\/span\s*>/)?.[0] ?? ''

test.each([
  ['ja', '運営者: '],
  ['en', 'Operated by '],
] as const)(
  'F34-AC21: Given a %s page, When the footer is drawn, Then it says "%s" and the name kobaken, among the links',
  (lang, lead) => {
    const markup = render(lang)
    const text = operator(markup)
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    expect(text).toBe(`${lead}kobaken`.trim())
    // It is inside the footer's links, before the GitHub mark and the language choice.
    expect(markup.indexOf('class="operator"')).toBeGreaterThan(
      markup.indexOf('href="/contact"'),
    )
    expect(markup.indexOf('class="operator"')).toBeLessThan(
      markup.indexOf('class="github-link"'),
    )
  },
)

test('F34-AC22: Given the footer, When the name is drawn, Then only kobaken links, to https://x.com/kfly8', () => {
  expect(OPERATOR_NAME).toBe('kobaken')
  expect(OPERATOR_URL).toBe('https://x.com/kfly8')
  for (const lang of ['ja', 'en'] as const) {
    const markup = operator(render(lang))
    expect(markup).toContain(`href="${OPERATOR_URL}"`)
    expect(markup.match(/<a\s/g)).toHaveLength(1)
    expect(markup).toMatch(/>\s*kobaken\s*<\/a/)
    expect(markup).toContain('rel="noopener noreferrer"')
  }
})
