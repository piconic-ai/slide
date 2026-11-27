import { describe, expect, test } from 'vitest'
import { deckSlugSchema } from '../decks/deck-id'
import { handleSchema } from '../share/handle'
import {
  toDiscoverCommunity,
  toDiscoverPerson,
  toFollowingDecks,
  type FollowingSlide,
} from './home-discover'

const slide = (
  over: Partial<FollowingSlide> & Pick<FollowingSlide, 'viaPerson'>,
): FollowingSlide => ({
  handle: handleSchema.parse('alice'),
  slug: deckSlugSchema.parse('talk'),
  title: null,
  readyAt: 1_700_000_000,
  deploymentId: '7ae11c67-633f-4f21-b2b1-80af84107421',
  coverPath: null,
  community: null,
  ...over,
})

describe('toFollowingDecks', () => {
  test('F44-AC7: Given a slide through a community, When it is drawn, Then the card names the community and links its page', () => {
    const [deck] = toFollowingDecks(
      [
        slide({
          viaPerson: false,
          community: {
            handle: handleSchema.parse('kanagawapm'),
            name: '<b>Kanagawa.pm</b> 🐪',
            color: 'navy',
          },
        }),
      ],
      null,
    )
    expect(deck?.source).toEqual({
      kind: 'community',
      name: '<b>Kanagawa.pm</b> 🐪',
      href: '/@kanagawapm',
      color: 'navy',
    })
    expect(deck?.href).toBe('/@alice/talk')
  })

  test('F44-AC7: Given a slide of a followed author, When it is drawn, Then its source is the person', () => {
    expect(
      toFollowingDecks([slide({ viaPerson: true })], null)[0]?.source,
    ).toEqual({ kind: 'person' })
  })

  test('Given a slide with no source, When it is drawn, Then it is left out and the others keep their order', () => {
    const decks = toFollowingDecks(
      [
        slide({ viaPerson: true, slug: deckSlugSchema.parse('one') }),
        slide({ viaPerson: false, slug: deckSlugSchema.parse('none') }),
        slide({ viaPerson: true, slug: deckSlugSchema.parse('two') }),
      ],
      null,
    )
    expect(decks.map((deck) => deck.slug)).toEqual(['one', 'two'])
  })

  test('Given an empty list, When it is drawn, Then it is empty', () => {
    expect(toFollowingDecks([], null)).toEqual([])
  })

  test('Given a slide cited twice, When it is drawn, Then the count comes with it', () => {
    const [deck] = toFollowingDecks(
      [slide({ viaPerson: true })],
      null,
      new Map([['alice/talk', 2]]),
    )
    expect(deck?.citedBy).toBe(2)
  })
})

describe('toDiscoverPerson', () => {
  const person = {
    userId: '1',
    handle: handleSchema.parse('bob'),
    avatarUrl: '/avatars/1?v=n',
    followedByViewer: false,
    followsViewer: false,
  }

  test('F44-AC19: Given a person with an emoji name, When they are drawn, Then the initial is the whole emoji', () => {
    expect(toDiscoverPerson({ ...person, name: '🐪 Camel' })).toMatchObject({
      name: '🐪 Camel',
      initial: '🐪',
      href: '/@bob',
    })
  })

  test('F44-AC19: Given a person without a name or with a blank one, When they are drawn, Then the handle stands for the name', () => {
    expect(toDiscoverPerson({ ...person, name: null })).toMatchObject({
      name: 'bob',
      initial: 'B',
    })
  })

  test('F44-AC19: Given a person, When they are drawn, Then only the fields of the card come', () => {
    expect(
      Object.keys(toDiscoverPerson({ ...person, name: 'Bob' })).sort(),
    ).toEqual(['avatarUrl', 'handle', 'href', 'initial', 'name'])
  })
})

describe('toDiscoverCommunity', () => {
  test('F44-AC20: Given a community, When it is drawn, Then the card holds its handle, name, description, link and logo', () => {
    expect(
      toDiscoverCommunity({
        id: 7,
        handle: handleSchema.parse('kanagawapm'),
        name: 'Kanagawa.pm',
        description: '',
        color: 'navy',
        logoAt: null,
        coverAt: null,
        createdAt: 5,
      }),
    ).toMatchObject({
      handle: 'kanagawapm',
      name: 'Kanagawa.pm',
      description: '',
      href: '/@kanagawapm',
      logo: { kind: 'initial', letter: 'K' },
    })
  })
})
