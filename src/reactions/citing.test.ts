import { expect, test } from 'vitest'
import { citingDecks, DECKS_SHOWN, shorten } from './citing'
import type { DeckLink } from './store'

const link = (page: number, at: number, slug = 'reply'): DeckLink => ({
  handle: 'reader',
  slug,
  title: 'Reply',
  page,
  deploymentId: `deployment-of-${slug}`,
  at,
})

test('Given a deck linking to several pages, When the citing decks are listed, Then it is listed once', () => {
  expect(citingDecks([link(26, 200), link(0, 200), link(6, 200)])).toEqual([
    {
      handle: 'reader',
      slug: 'reply',
      title: 'Reply',
      deploymentId: 'deployment-of-reply',
    },
  ])
})

test('Given several citing decks, When listed, Then the most recently published comes first', () => {
  const decks = citingDecks([
    link(6, 100, 'first'),
    link(6, 300, 'third'),
    link(9, 200, 'second'),
  ])

  expect(decks.map((deck) => deck.slug)).toEqual(['third', 'second', 'first'])
})

test('Given no links, When the citing decks are listed, Then there are none', () => {
  expect(citingDecks([])).toEqual([])
})

test('Given more decks than are shown, When shortened, Then the first ones are kept and the rest are counted', () => {
  const decks = Array.from({ length: DECKS_SHOWN + 3 }, (_, index) => index)

  expect(shorten(decks)).toEqual({
    shown: decks.slice(0, DECKS_SHOWN),
    more: 3,
  })
})

test.each([
  ['as many as are shown', DECKS_SHOWN],
  ['fewer', 1],
  ['none', 0],
])(
  'Given %s, When shortened, Then all are kept and none are left over',
  (_, length) => {
    const decks = Array.from({ length }, (_, index) => index)

    expect(shorten(decks)).toEqual({ shown: decks, more: 0 })
  },
)

test.each([0, -1])(
  'Given the limit %i, When shortened, Then nothing is shown and all are counted',
  (limit) => {
    expect(shorten([1, 2], limit)).toEqual({ shown: [], more: 2 })
  },
)
