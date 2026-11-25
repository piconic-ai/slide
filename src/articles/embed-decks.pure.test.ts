import { describe, expect, test } from 'vitest'
import { decksOf } from './embed-decks'

const page = (handle: string, slug: string, number: number) => ({
  handle,
  slug,
  page: number,
})

describe('F26-AC102: the slides an article’s pages belong to', () => {
  test('Given no pages, When the slides are read, Then there are none', () => {
    expect(decksOf([])).toEqual([])
  })

  test('Given many pages of one slides, When the slides are read, Then they are one', () => {
    const pages = Array.from({ length: 30 }, (_, index) =>
      page('ann', 'deck', index + 1),
    )
    expect(decksOf(pages)).toEqual([{ handle: 'ann', slug: 'deck' }])
  })

  test('Given pages of slides written in turn, When the slides are read, Then each is listed once in the order first written', () => {
    expect(
      decksOf([
        page('bob', 'b', 1),
        page('ann', 'a', 2),
        page('bob', 'b', 3),
        page('ann', 'a', 2),
      ]),
    ).toEqual([
      { handle: 'bob', slug: 'b' },
      { handle: 'ann', slug: 'a' },
    ])
  })

  test('Given the same name under two authors and two names under one, When the slides are read, Then each pair is its own slides', () => {
    expect(
      decksOf([
        page('ann', 'deck', 1),
        page('bob', 'deck', 1),
        page('ann', 'other', 1),
      ]),
    ).toHaveLength(3)
  })

  test('Given a handle and a name that run together the same, When the slides are read, Then they stay apart', () => {
    // Handles and slugs hold no "/", so the key cannot join two names into one.
    expect(decksOf([page('a-b', 'c', 1), page('a', 'b-c', 1)])).toHaveLength(2)
  })
})
