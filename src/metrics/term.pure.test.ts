import { expect, test } from 'vitest'
import { MAX_TERM_CHARS, searchTermOf } from './term'

test.each([
  ['  embed   code ', 'embed code'],
  ['ＡＢＣ　ｄｅｆ', 'ABC def'],
  ['公開の止め方', '公開の止め方'],
])(
  'F40-AC12: Given the word %j, When it is kept, Then it is tidied to %j',
  (raw, kept) => {
    expect(searchTermOf(raw)).toBe(kept)
  },
)

test('F40-AC12: Given a word of 50 characters, When it is kept, Then it is whole; one more is cut', () => {
  expect(searchTermOf('あ'.repeat(MAX_TERM_CHARS))).toBe(
    'あ'.repeat(MAX_TERM_CHARS),
  )
  expect(searchTermOf('あ'.repeat(MAX_TERM_CHARS + 1))).toBe(
    'あ'.repeat(MAX_TERM_CHARS),
  )
})

test('F40-AC12: Given emoji at the cut, When it is kept, Then it is cut by characters, not in the middle of one', () => {
  const kept = searchTermOf('😀'.repeat(MAX_TERM_CHARS + 5))
  expect([...(kept ?? '')]).toHaveLength(MAX_TERM_CHARS)
  expect(kept).toBe('😀'.repeat(MAX_TERM_CHARS))
})

test.each([
  '',
  '   ',
  '\n\t',
  'name@example.com',
  'find me at foo.bar@mail.example please',
  '203.0.113.9',
  'my ip is 10.1.2.3',
  '2001:db8::1',
  'https://example.com/x',
  'www.example.com',
  // Built here so that the file holds no string a secret scanner would take.
  ['ghp', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_'),
  '0123456789abcdef0123456789abcdef',
  '722500-abcdefgh-ijklmnop-qrstuvwx',
])(
  'F40-AC12, F40-AC15: Given the word %j that is empty or looks like an address or a secret, When it is kept, Then nothing is kept',
  (raw) => {
    expect(searchTermOf(raw)).toBeNull()
  },
)

test('F40-AC15: Given an address placed after 50 characters, When it is kept, Then it is not kept, since the whole word is looked at before the cut', () => {
  expect(searchTermOf(`${'あ'.repeat(60)} a@b.example`)).toBeNull()
})
