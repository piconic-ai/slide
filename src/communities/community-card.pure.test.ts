import { describe, expect, it, test } from 'vitest'
import type { Handle } from '../share/handle'
import { COMMUNITY_COLORS, coverShades } from '../site/cover-pattern'
import {
  cardSquares,
  toCommunityCard,
  toneCss,
  type ListedCommunity,
} from './community-card'
import { communityCard } from './card-markup'

const listed = (over: Partial<ListedCommunity> = {}): ListedCommunity => ({
  id: 7,
  handle: 'kanagawapm' as Handle,
  name: 'Kanagawa.pm',
  description: 'Perl in Kanagawa',
  color: 'green',
  logoAt: null,
  coverAt: null,
  ...over,
})

const flat = async (markup: unknown) =>
  String(await markup).replace(/\s+/g, ' ')

describe('toCommunityCard', () => {
  test('F30-AC46: Given a community with no uploaded cover or logo, When made a card, Then it links its page and shows the default pattern and its initial on its color', () => {
    const card = toCommunityCard(listed())
    expect(card.href).toBe('/@kanagawapm')
    expect(card.cover.kind).toBe('pattern')
    expect(card.logo).toEqual({
      kind: 'initial',
      letter: 'K',
      className: expect.stringMatching(/^tone-green tone-text-/),
    })
  })

  test('F30-AC46: Given a community with an uploaded cover and logo, When made a card, Then both are the served images', () => {
    const card = toCommunityCard(listed({ logoAt: 11, coverAt: 12 }))
    expect(card.cover).toEqual({
      kind: 'image',
      url: '/communities/7/cover?v=12',
    })
    expect(card.logo).toEqual({
      kind: 'image',
      url: '/communities/7/logo?v=11',
    })
  })

  it.each([
    ['an emoji', '🍣 club', '🍣'],
    ['a letter with marks', 'é', 'É'],
    ['leading spaces', '  hono', 'H'],
  ])(
    'F30-AC46: Given a name starting with %s, When made a card, Then the initial is its first letter whole',
    (_, name, letter) => {
      const card = toCommunityCard(listed({ name }))
      expect(card.logo.kind === 'initial' && card.logo.letter).toBe(letter)
    },
  )
})

describe('cardSquares', () => {
  test('F30-AC46: Given a seed, When the card pattern is made, Then it is the eight squares of each row the narrow page keeps, in the same order every time', () => {
    const squares = cardSquares('navy', 42)
    expect(squares).toHaveLength(16)
    expect(cardSquares('navy', 42)).toEqual(squares)
    const shades = coverShades(42)
    const kept = [...shades.slice(0, 8), ...shades.slice(16, 24)]
    const suffix = ['-light', '', '-dark']
    expect(squares).toEqual(kept.map((shade) => `tone-navy${suffix[shade]}`))
  })

  test('F30-AC46: Given every color and shade, When the styles are read, Then each square class has a rule painting it with its token', () => {
    for (const color of COMMUNITY_COLORS)
      for (const square of cardSquares(color, 3))
        expect(toneCss).toContain(`.${square} { background: var(--community-`)
  })
})

describe('communityCard', () => {
  test('F30-AC46: Given a name and description holding HTML, When the card is drawn, Then they are text, the cover and logo are hidden from screen readers, and no follow button is drawn', async () => {
    const card = toCommunityCard(
      listed({
        name: '<script>alert(1)</script>',
        description: '<b>bold</b> & more',
      }),
    )
    const html = await flat(communityCard(card))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt; &amp; more')
    expect(html).toMatch(
      /class="community-card-cover [^"]*" aria-hidden="true"/,
    )
    expect(html).toContain('href="/@kanagawapm"')
    expect(html).not.toMatch(/<button|<form/)
  })

  test('F30-AC46: Given a community with no description, When the card is drawn, Then the description line is still there, empty, to keep the card height', async () => {
    const html = await flat(
      communityCard(toCommunityCard(listed({ description: '' }))),
    )
    expect(html).toContain('<span class="community-card-description"></span>')
  })
})
