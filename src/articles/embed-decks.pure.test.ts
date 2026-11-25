import { describe, expect, test } from 'vitest'
import { decksOf, MAX_OTHER_DECKS, pagesWithinLimit } from './embed-decks'

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

describe('F26-AC101, F26-AC102, F26-AC103: which pages are looked up', () => {
  const own = { handle: 'owner', slug: 'talk' }
  const others = (count: number, pages = 1) =>
    Array.from({ length: count }, (_, deck) =>
      Array.from({ length: pages }, (_, index) =>
        page('ann', `d${deck}`, index + 1),
      ),
    ).flat()

  test('Given no pages, When they are limited, Then none are left', () => {
    expect(pagesWithinLimit([], own)).toEqual([])
  })

  test('F26-AC101: Given a hundred pages of the article’s own slides, When they are limited, Then every one is kept', () => {
    const pages = Array.from({ length: 100 }, (_, index) =>
      page('owner', 'talk', index + 1),
    )
    expect(pagesWithinLimit(pages, own)).toEqual(pages)
  })

  test('F26-AC102: Given forty other slides of thirty pages each, When they are limited, Then every page is kept', () => {
    const pages = others(MAX_OTHER_DECKS, 30)
    expect(MAX_OTHER_DECKS).toBe(40)
    expect(pagesWithinLimit(pages, own)).toEqual(pages)
  })

  test('F26-AC102, F26-AC103: Given forty-one other slides, When they are limited, Then the pages of the first forty are kept and those of the forty-first are not', () => {
    const pages = others(41, 2)
    const kept = pagesWithinLimit(pages, own)
    expect(kept).toEqual(pages.slice(0, 80))
    expect(kept.some((ref) => ref.slug === 'd40')).toBe(false)
  })

  test('F26-AC103: Given a later page of the first slides after the forty-first, When they are limited, Then it is kept, since slides count where they are first written', () => {
    const pages = [...others(41), page('ann', 'd0', 9)]
    const kept = pagesWithinLimit(pages, own)
    expect(kept.map((ref) => `${ref.slug}/${ref.page}`)).toEqual([
      ...Array.from({ length: 40 }, (_, deck) => `d${deck}/1`),
      'd0/9',
    ])
  })

  test('F26-AC101, F26-AC103: Given the own slides between other slides past the limit, When they are limited, Then the own pages are kept wherever they stand and do not count', () => {
    const pages = [
      page('owner', 'talk', 1),
      ...others(40),
      page('owner', 'talk', 2),
      page('ann', 'd40', 1),
      page('owner', 'talk', 3),
    ]
    expect(
      pagesWithinLimit(pages, own).map((ref) => `${ref.slug}/${ref.page}`),
    ).toEqual([
      'talk/1',
      ...Array.from({ length: 40 }, (_, deck) => `d${deck}/1`),
      'talk/2',
      'talk/3',
    ])
  })

  test('F26-AC102: Given other slides of the same author as the own slides, When they are limited, Then they count as other slides', () => {
    const pages = [
      ...Array.from({ length: 40 }, (_, deck) => page('owner', `o${deck}`, 1)),
      page('ann', 'deck', 1),
    ]
    expect(pagesWithinLimit(pages, own)).toEqual(pages.slice(0, 40))
  })
})
