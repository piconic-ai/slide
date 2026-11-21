import { describe, expect, test } from 'vitest'
import { bodyLength, checkBody, normalizeBody } from './article'
import { MAX_ARTICLE_CHARS } from './markdown'

describe('F26-AC16: the body is at most 50,000 characters', () => {
  test.each([
    ['empty, as a draft', '', false, true],
    ['one character', 'a', false, true],
    ['exactly 50,000 characters', 'a'.repeat(50_000), false, true],
    ['exactly 50,000 characters, published', 'a'.repeat(50_000), true, true],
    ['50,001 characters', 'a'.repeat(50_001), false, false],
    ['50,001 characters, published', 'a'.repeat(50_001), true, false],
    [
      '50,000 emoji, each two UTF-16 units but one character',
      '😀'.repeat(50_000),
      false,
      true,
    ],
    ['50,001 emoji', '😀'.repeat(50_001), false, false],
    ['50,000 Japanese characters', 'あ'.repeat(50_000), false, true],
    [
      '50,000 lines of CRLF, kept as one character each',
      '\r\n'.repeat(50_000),
      false,
      true,
    ],
  ])(
    'Given %s, When checked, Then it is kept: %s',
    (_name, body, publishing, kept) => {
      expect(checkBody(body, { publishing }).ok).toBe(kept)
    },
  )

  test('Given a too long body, When checked, Then the reason is too_long', () => {
    expect(
      checkBody('a'.repeat(MAX_ARTICLE_CHARS + 1), { publishing: false }),
    ).toEqual({
      ok: false,
      reason: 'too_long',
    })
  })
})

describe('F26-AC6, F26-AC4: a body to publish has something in it', () => {
  test.each(['', '   ', '\n\n', '\r\n \t'])(
    'Given %j, When checked for publishing, Then it is refused as empty, but a draft may be saved',
    (body) => {
      expect(checkBody(body, { publishing: true })).toEqual({
        ok: false,
        reason: 'empty',
      })
      expect(checkBody(body, { publishing: false }).ok).toBe(true)
    },
  )
})

describe('F26-AC1: the body is kept as text with plain line ends', () => {
  test('Given CRLF, CR and null characters, When normalized, Then only newlines remain', () => {
    expect(normalizeBody('a\r\nb\rc\u0000d')).toBe('a\nb\ncd')
  })

  test('Given a body with emoji, When counted, Then a character is one', () => {
    expect(bodyLength('a😀b')).toBe(3)
    expect(bodyLength('a'.repeat(50_000) + '😀')).toBe(50_001)
  })
})
