import { describe, expect, test } from 'vitest'
import {
  CAROUSEL_AFTER,
  timelineItems,
  sourceOf,
  type TimelineItem,
} from './home-timeline'

const decks = (count: number, from = 1) =>
  Array.from({ length: count }, (_, index) => `deck-${from + index}`)

const both = { people: true, communities: true }
const none = { people: false, communities: false }

/** The items as a short line: the deck numbers, `P` and `C` for carousels. */
const line = (items: readonly TimelineItem<string>[]) =>
  items
    .map((item) =>
      item.kind === 'deck'
        ? item.deck.replace('deck-', '')
        : item.carousel === 'people'
          ? 'P'
          : 'C',
    )
    .join(' ')

describe('timelineItems', () => {
  test('F44-AC15: Given twelve slides, When both carousels have people, Then people stand after the 4th slide and communities after the 10th', () => {
    expect(line(timelineItems(decks(12), [], both))).toBe(
      '1 2 3 4 P 5 6 7 8 9 10 C 11 12',
    )
  })

  test('F44-AC15: Given exactly four slides, When the carousels are set in, Then people stand at their place and communities after the last slide', () => {
    expect(CAROUSEL_AFTER).toEqual({ people: 4, communities: 10 })
    expect(line(timelineItems(decks(4), [], both))).toBe('1 2 3 4 P C')
  })

  test('F44-AC15: Given three slides, When both carousels are present, Then both stand after the last slide, people first', () => {
    expect(line(timelineItems(decks(3), [], both))).toBe('1 2 3 P C')
  })

  test('F44-AC15: Given no slide, When both carousels are present, Then the carousels stand alone, people first', () => {
    expect(line(timelineItems([], [], both))).toBe('P C')
  })

  test('F44-AC15: Given six slides, When only the communities have anything to show, Then they stand after the last slide and the people leave no place', () => {
    expect(
      line(timelineItems(decks(6), [], { people: false, communities: true })),
    ).toBe('1 2 3 4 5 6 C')
  })

  test('F44-AC23: Given nothing for either carousel, When items are made, Then only the slides remain', () => {
    expect(line(timelineItems(decks(12), [], none))).toBe(
      '1 2 3 4 5 6 7 8 9 10 11 12',
    )
    expect(line(timelineItems([], [], none))).toBe('')
  })

  test('F44-AC16: Given slides added by "show more", When items are made, Then they follow everything and take no carousel', () => {
    expect(line(timelineItems(decks(12), decks(100, 13), both))).toBe(
      `1 2 3 4 P 5 6 7 8 9 10 C 11 12 ${decks(100, 13)
        .map((name) => name.replace('deck-', ''))
        .join(' ')}`,
    )
  })

  test('F44-AC16: Given fewer slides than a place and some added, When items are made, Then the carousels stand before the added slides, so they do not move', () => {
    expect(line(timelineItems(decks(3), decks(2, 4), both))).toBe(
      '1 2 3 P C 4 5',
    )
  })

  test('Given the same input, When items are made twice, Then the answers are equal and the input is not changed', () => {
    const first = decks(5)
    const added = decks(2, 6)
    expect(timelineItems(first, added, both)).toEqual(
      timelineItems(first, added, both),
    )
    expect(first).toEqual(decks(5))
    expect(added).toEqual(decks(2, 6))
  })
})

describe('sourceOf', () => {
  const community = {
    name: 'Kanagawa.pm 🐪',
    href: '/@kanagawapm',
    color: 'navy' as const,
  }

  test('F44-AC7: Given a slide of a followed author only, When its source is read, Then it is the followed person', () => {
    expect(sourceOf({ person: true, community: null })).toEqual({
      kind: 'person',
    })
  })

  test('F44-AC7: Given a slide of a followed community only, When its source is read, Then it is that community', () => {
    expect(sourceOf({ person: false, community })).toEqual({
      kind: 'community',
      ...community,
    })
  })

  test('F44-AC7: Given a slide of a followed author that is also in a followed community, When its source is read, Then the community is shown', () => {
    expect(sourceOf({ person: true, community })).toMatchObject({
      kind: 'community',
      name: community.name,
    })
  })

  test('Given a slide that is neither, When its source is read, Then there is none', () => {
    expect(sourceOf({ person: false, community: null })).toBeNull()
  })
})
