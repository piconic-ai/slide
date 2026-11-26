import { describe, expect, test } from 'vitest'
import { exportRefusalBody } from '../exports/export-pages'
import { LANGS } from '../site/i18n'
import { loginPage } from './login-pages'

const url = new URL('https://slide.example/login')

const login = async (
  lang: (typeof LANGS)[number],
  patch: Partial<Parameters<typeof loginPage>[2]> = {},
) =>
  String(
    await loginPage(lang, url, {
      carry: {},
      mode: 'invitation',
      paused: false,
      ...patch,
    }),
  )

describe('the sign-in page leads a refusal to its article', () => {
  test.each(LANGS)(
    'F36-AC46: Given sign-ups are paused, When the page is drawn in %s, Then one link leads to the article on signing up',
    async (lang) => {
      const page = await login(lang, { paused: true })
      expect(page).toContain('href="/help/start/sign-up"')
      expect(page.match(/href="\/help\/[^"]*"/g)).toHaveLength(1)
    },
  )

  test.each(LANGS)(
    'F36-AC46: Given sign-ups are not paused, When the page is drawn in %s, Then it holds no link to the help',
    async (lang) => {
      expect(await login(lang)).not.toContain('href="/help/')
    },
  )

  test.each(LANGS)(
    'F36-AC46: Given too many codes were asked for, When the page is drawn in %s, Then a link leads to the article on a code that does not arrive, and a wrong address gets none',
    async (lang) => {
      const busy = await login(lang, { problem: { kind: 'busy' } })
      expect(busy).toContain('href="/help/start/code-not-arrived"')
      const invalid = await login(lang, { problem: { kind: 'invalid_email' } })
      expect(invalid).not.toContain('href="/help/')
    },
  )

  test('F36-AC46: Given the same refusal for any address, When it is drawn, Then the link does not depend on who asked', async () => {
    const a = await login('ja', {
      problem: { kind: 'busy' },
      email: 'a@x.example',
    })
    const b = await login('ja', {
      problem: { kind: 'busy' },
      email: 'b@y.example',
    })
    expect(a.replaceAll('a@x.example', '').replaceAll('b@y.example', '')).toBe(
      b.replaceAll('a@x.example', '').replaceAll('b@y.example', ''),
    )
  })
})

describe('the page of a refused export leads to the article on it', () => {
  test.each(
    LANGS.flatMap((lang) =>
      (['busy', 'too_large', 'unavailable'] as const).map(
        (refusal) => [lang, refusal] as const,
      ),
    ),
  )(
    'F36-AC46: Given an export refused in %s for %s, When the page is drawn, Then one link leads to the article on taking a zip',
    async (lang, refusal) => {
      const page = String(await exportRefusalBody(lang, refusal, '/settings'))
      expect(page.match(/href="\/help\/[^"]*"/g)).toEqual([
        'href="/help/account/export-slide"',
      ])
    },
  )
})
