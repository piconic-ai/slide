import { describe, expect, test } from 'vitest'
import { followListStale, followPromptKind, followRequest } from './home-follow'

describe('followRequest', () => {
  test.each([
    ['person', false, '/follows', { handle: 'bob', slide: '/' }],
    ['person', true, '/follows/bob/release', { handle: 'bob', slide: '/' }],
    ['community', false, '/communities/follows', { handle: 'bob', back: '/' }],
    [
      'community',
      true,
      '/communities/follows/release',
      { handle: 'bob', back: '/' },
    ],
  ] as const)(
    'F44-AC21: Given a %s with release=%s, When the request is made, Then it goes to %s with the fields of that form',
    (kind, release, path, fields) => {
      expect(followRequest(kind, 'bob', release)).toEqual({ path, fields })
    },
  )

  test('Given a handle with characters a path must escape, When the release is made, Then the path is escaped and the field is not', () => {
    const request = followRequest('person', 'a/b?c', true)
    expect(request.path).toBe('/follows/a%2Fb%3Fc/release')
    expect(request.fields.handle).toBe('a/b?c')
  })

  test('F44-AC22: Given each kind, When the sign-in prompt is chosen, Then a person gets "follow" and a community "follow-community"', () => {
    expect(followPromptKind('person')).toBe('follow')
    expect(followPromptKind('community')).toBe('follow-community')
  })
})

describe('followListStale', () => {
  test('F44-AC26: Given no follow changed, When the tab is in view, Then the list is current', () => {
    expect(followListStale(0, 0, true)).toBe(false)
  })
  test('F44-AC26: Given a follow changed, When the tab is not in view, Then the list is left alone', () => {
    expect(followListStale(2, 0, false)).toBe(false)
  })
  test('F44-AC26: Given a follow changed, When the tab comes into view, Then the list is stale, and current once asked at that count', () => {
    expect(followListStale(1, 0, true)).toBe(true)
    expect(followListStale(1, 1, true)).toBe(false)
  })
})
