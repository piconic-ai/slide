import { describe, expect, test } from 'vitest'
import {
  HOME_MORE_STEP,
  communityMoreQuery,
  deckMoreQuery,
  firstQuery,
  takeShown,
} from './home-more'
import {
  HOME_MORE_LIMIT,
  parseCommunityPage,
  parseDeckPage,
} from './home-more-query'

const query = (search: string) =>
  Object.fromEntries(new URLSearchParams(search))

describe('the query of the next cards', () => {
  test('F03-AC162: Given the last slide a list shows, When it asks for more, Then the query names its keys and the step and one more', () => {
    const search = deckMoreQuery({ at: 1700000000, handle: 'alice', slug: 'a' })
    expect(query(search)).toEqual({
      at: '1700000000',
      handle: 'alice',
      slug: 'a',
      limit: String(HOME_MORE_STEP + 1),
    })
  })

  test('F03-AC162: Given the last community a list shows, When it asks for more, Then the query names when it was made and its number', () => {
    expect(query(communityMoreQuery({ at: 5, id: 7 }))).toEqual({
      at: '5',
      id: '7',
      limit: String(HOME_MORE_STEP + 1),
    })
  })

  test('Given a list that shows 8, When it asks for its first cards, Then it asks for 9', () => {
    expect(firstQuery(8)).toBe('?limit=9')
  })
})

describe('the cards a list shows of what came', () => {
  test('F03-AC164: Given one card more than the list shows, When it is cut, Then the list shows its cards and knows more stand after them', () => {
    expect(takeShown([1, 2, 3], 2)).toEqual({ cards: [1, 2], more: true })
  })

  test('F03-AC164: Given exactly as many as the list shows, When it is cut, Then nothing stands after them', () => {
    expect(takeShown([1, 2], 2)).toEqual({ cards: [1, 2], more: false })
  })

  test('F03-AC164: Given nothing, When it is cut, Then the list is empty and nothing stands after it', () => {
    expect(takeShown([], 2)).toEqual({ cards: [], more: false })
  })
})

describe('the page a route reads from the query', () => {
  test('Given no query, When a slide list reads it, Then it reads its own number of slides from the start', () => {
    expect(parseDeckPage({}, 8)).toEqual({ limit: 8, after: null })
  })

  test('F03-AC163: Given a query from deckMoreQuery, When a route reads it, Then it gets the same keys back', () => {
    const after = { at: 1700000000, handle: 'alice', slug: 'my-talk' }
    expect(parseDeckPage(query(deckMoreQuery(after)), 8)).toEqual({
      limit: HOME_MORE_LIMIT,
      after,
    })
  })

  test('F03-AC163: Given a query from communityMoreQuery, When a route reads it, Then it gets the same keys back', () => {
    expect(
      parseCommunityPage(query(communityMoreQuery({ at: 0, id: 3 })), 6),
    ).toEqual({
      limit: HOME_MORE_LIMIT,
      after: { at: 0, id: 3 },
    })
  })

  test.each([
    ['a limit of 0', 'limit=0'],
    ['a limit past one press', `limit=${HOME_MORE_LIMIT + 1}`],
    ['a limit that is not whole', 'limit=1.5'],
    ['a limit that is a word', 'limit=all'],
    ['an empty limit', 'limit='],
    ['only some of the keys', 'at=1&handle=alice'],
    ['a time that is a word', 'at=now&handle=alice&slug=a'],
    ['a negative time', 'at=-1&handle=alice&slug=a'],
    ['a handle no account can hold', 'at=1&handle=A%20B&slug=a'],
    ['an empty slug', 'at=1&handle=alice&slug='],
  ])(
    'Given %s, When a slide list reads it, Then the query is refused',
    (_name, search) => {
      expect(parseDeckPage(query(search), 8)).toBeNull()
    },
  )

  test.each([
    ['a community number of 0', 'at=1&id=0'],
    ['a community number that is a word', 'at=1&id=x'],
    ['a time alone', 'at=1'],
  ])(
    'Given %s, When the community list reads it, Then the query is refused',
    (_name, search) => {
      expect(parseCommunityPage(query(search), 6)).toBeNull()
    },
  )

  test('Given the most one press asks for, When a route reads it, Then it is allowed', () => {
    expect(parseDeckPage({ limit: String(HOME_MORE_LIMIT) }, 8)).toEqual({
      limit: HOME_MORE_LIMIT,
      after: null,
    })
  })
})
