import { describe, expect, test } from 'vitest'
import {
  bodyLength,
  buttonOf,
  checkBody,
  editingBody,
  isStale,
  nextFields,
  normalizeBody,
  revisionOf,
  stateOf,
} from './article'
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

describe('F26-AC49, F26-AC54, F26-AC55, F26-AC67: what an article holds after each action', () => {
  const draft = { body: 'd', draftBody: null, status: 'draft' } as const
  const live = { body: 'p', draftBody: null, status: 'published' } as const
  const pending = { body: 'p', draftBody: 'e', status: 'published' } as const

  test.each([
    [
      'no article, autosave',
      null,
      'autosave',
      'x',
      { body: 'x', draftBody: null, status: 'draft' },
    ],
    [
      'draft, autosave',
      draft,
      'autosave',
      'x',
      { body: 'x', draftBody: null, status: 'draft' },
    ],
    [
      'published, autosave',
      live,
      'autosave',
      'x',
      { body: 'p', draftBody: 'x', status: 'published' },
    ],
    [
      'published, autosave of the published text',
      pending,
      'autosave',
      'p',
      live,
    ],
    [
      'pending, autosave',
      pending,
      'autosave',
      'y',
      { body: 'p', draftBody: 'y', status: 'published' },
    ],
    [
      'no article, publish',
      null,
      'publish',
      'x',
      { body: 'x', draftBody: null, status: 'published' },
    ],
    [
      'draft, publish',
      draft,
      'publish',
      'x',
      { body: 'x', draftBody: null, status: 'published' },
    ],
    [
      'pending, update',
      pending,
      'update',
      'e',
      { body: 'e', draftBody: null, status: 'published' },
    ],
    ['pending, discard', pending, 'discard', null, live],
    [
      'pending, unpublish',
      pending,
      'unpublish',
      null,
      { body: 'e', draftBody: null, status: 'draft' },
    ],
    [
      'published, unpublish',
      live,
      'unpublish',
      null,
      { body: 'p', draftBody: null, status: 'draft' },
    ],
  ] as const)(
    'Given %s, When it happens, Then the article holds what the rules say',
    (_name, current, action, sent, expected) => {
      expect(nextFields(current, action, sent)).toEqual(expected)
    },
  )

  test.each([
    ['no article', null, 'update'],
    ['a draft', draft, 'update'],
    ['a draft', draft, 'discard'],
    ['a draft', draft, 'unpublish'],
    ['no article', null, 'discard'],
    ['no article', null, 'unpublish'],
  ] as const)(
    'Given %s, When %s is asked, Then it does not apply',
    (_name, current, action) => {
      expect(nextFields(current, action, 'x')).toBeNull()
    },
  )

  test('Given an autosave or publish with no text, When it is asked, Then it does not apply', () => {
    expect(nextFields(live, 'autosave', null)).toBeNull()
    expect(nextFields(live, 'publish', null)).toBeNull()
  })
})

describe('F26-AC52, F26-AC53: the state and the text the page opens', () => {
  test.each([
    [null, 'none', ''],
    [{ body: 'd', draftBody: null, status: 'draft' }, 'draft', 'd'],
    [{ body: 'p', draftBody: null, status: 'published' }, 'published', 'p'],
    [{ body: 'p', draftBody: 'e', status: 'published' }, 'pending', 'e'],
    [{ body: 'p', draftBody: '', status: 'published' }, 'pending', ''],
  ] as const)(
    'Given %j, When read, Then it is %s and opens %j',
    (article, state, shown) => {
      expect(stateOf(article)).toBe(state)
      expect(editingBody(article)).toBe(shown)
    },
  )
})

describe('F26-AC57: a save from an old screen is found', () => {
  test.each([
    [null, null, false],
    [3, 3, false],
    [3, 4, true],
    [null, 1, true],
    [2, null, true],
  ] as const)(
    'Given a screen at %j and an article at %j, When compared, Then stale is %s',
    (known, stored, stale) => {
      expect(isStale(known, stored)).toBe(stale)
    },
  )

  test.each([
    ['', null],
    [undefined, null],
    ['0', 0],
    ['12', 12],
    ['abc', undefined],
    ['-1', undefined],
    ['1.5', undefined],
    ['1234567890', undefined],
    [5, undefined],
  ] as const)('Given the field %j, When read, Then it is %j', (value, read) => {
    expect(revisionOf(value)).toBe(read)
  })
})

describe('the buttons of the form', () => {
  test.each(['publish', 'update', 'discard', 'unpublish'])(
    'Given %s, When read, Then it is a button',
    (word) => {
      expect(buttonOf(word)).toBe(word)
    },
  )
  test.each(['save', 'autosave', 'preview', 'write', '', null, 5])(
    'Given %j, When read, Then it is no button',
    (word) => {
      expect(buttonOf(word)).toBeNull()
    },
  )
})
