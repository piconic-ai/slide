import { expect, test } from 'vitest'
import { DEFAULT_LANG, isLang, langHref, messages } from './i18n'

test.each([
  ['ja', true],
  ['en', true],
  ['fr', false],
  ['EN', false],
  ['en-US', false],
  ['', false],
  [undefined, false],
  [1, false],
])(
  'Given %j, When checked, Then it is a supported language: %s',
  (value, ok) => {
    expect(isLang(value)).toBe(ok)
  },
)

test('Given no detected language, Then the default is Japanese', () => {
  expect(DEFAULT_LANG).toBe('ja')
})

test.each([
  ['https://slide.example/', 'en', '/?lang=en'],
  ['https://slide.example/@kobaken/talk', 'ja', '/@kobaken/talk?lang=ja'],
  ['https://slide.example/decks?lang=ja', 'en', '/decks?lang=en'],
  [
    'https://slide.example/decks/x?before=a%26b',
    'en',
    '/decks/x?before=a%26b&lang=en',
  ],
  ['https://slide.example/x?lang=fr&lang=ja#top', 'en', '/x?lang=en'],
] as const)(
  'Given the page %s, When switching to %s, Then the link is %s',
  (url, lang, href) => {
    expect(langHref(new URL(url), lang)).toBe(href)
  },
)

test('Given wording in every language, When looked up, Then each language gets its own', () => {
  const text = messages({ ja: { hello: 'こんにちは' }, en: { hello: 'Hello' } })
  expect(text.en.hello).toBe('Hello')
  expect(text.ja.hello).toBe('こんにちは')
})

test('Given English wording that does not match Japanese, Then the type check fails', () => {
  // These calls exist for `tsc --noEmit`; the runtime result is irrelevant.
  messages({
    ja: { a: 'x', b: 'y' },
    // @ts-expect-error English lacks a key Japanese has.
    en: { a: 'x' },
  })
  messages({
    ja: { a: 'x' },
    // @ts-expect-error English has a key Japanese lacks.
    en: { a: 'x', c: 'z' },
  })
  messages({
    ja: { n: (count: number) => `${count}` },
    // @ts-expect-error A wording function returns something else.
    en: { n: (count: number) => count },
  })
  // @ts-expect-error A language is missing altogether.
  messages({ ja: { a: 'x' } })
})
