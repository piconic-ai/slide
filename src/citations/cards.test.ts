import { expect, test } from 'vitest'
import { deckSlugSchema } from '../decks/binding'
import { handleSchema } from '../share/handle'
import { citationCardGrid, toCitationCard } from './cards'
import type { CitedDeck } from './store'

const deck: CitedDeck = {
  handle: handleSchema.parse('reader'),
  slug: deckSlugSchema.parse('reply'),
  title: 'Reply',
  deploymentId: '11111111-1111-4111-8111-111111111111',
  coverPath: null,
  at: 1_800_000_000,
}
const base = new URL('https://content.example')

test('Given a deck that names no cover, When its card is made, Then the cover is the one the service takes and the links lead to the deck and its author', () => {
  expect(toCitationCard(deck, base)).toEqual({
    name: 'Reply',
    href: '/@reader/reply',
    handle: 'reader',
    authorHref: '/@reader',
    publishedAt: 1_800_000_000,
    coverUrl: '/covers/11111111-1111-4111-8111-111111111111.jpg',
  })
})

test('Given a deck that names a cover with spaces, When its card is made, Then the cover is that file on the version’s origin', () => {
  expect(
    toCitationCard({ ...deck, coverPath: 'img/og 1.png' }, base).coverUrl,
  ).toBe(
    'https://d-11111111-1111-4111-8111-111111111111.content.example/img/og%201.png',
  )
})

test('Given no title and no content origin, When the card is made, Then it is named by the URL name and shows no image', () => {
  const card = toCitationCard({ ...deck, title: null }, null)

  expect(card.name).toBe('reply')
  expect(card.coverUrl).toBeNull()
})

test('Given no cards, When the grid is drawn, Then it is an empty list', async () => {
  expect(String(await citationCardGrid([], 'ja', 'x'))).not.toContain('<li')
})

test('Given cards, When the grid is drawn in each language, Then every card links to its deck, names its author and writes the day in that language', async () => {
  const cards = [toCitationCard(deck, base)]

  const ja = String(await citationCardGrid(cards, 'ja', 'cites'))
  const en = String(await citationCardGrid(cards, 'en', 'cites'))

  expect(ja).toContain('aria-labelledby="cites"')
  expect(ja).toContain('class="deck-grid"')
  expect(String(await citationCardGrid(cards, 'ja', 'cites', 4))).toContain(
    'class="deck-grid deck-grid-4"',
  )
  expect(ja).toContain('<a class="card-title" href="/@reader/reply">')
  expect(ja).toContain('<a href="/@reader">@reader</a>')
  expect(ja).toContain('datetime="2027-01-15T08:00:00.000Z"')
  expect(ja).toContain('2027年1月15日')
  expect(en).toContain('Jan 15, 2027')
})
