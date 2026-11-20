import { expect, test } from 'vitest'
import { DECKS_SHOWN, shorten } from './citing'

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
