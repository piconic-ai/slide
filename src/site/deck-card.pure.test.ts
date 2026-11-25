import { expect, test } from 'vitest'
import { deckCard, deckCover } from './deck-card'

test('F03-AC10: Given a deck with a cover image, When its cover is drawn, Then the name sits on a face under the image, which is marked to be hidden when it fails', async () => {
  const cover = String(await deckCover('My talk', '/covers/a.jpg'))
  const name = cover.indexOf(
    '<span class="deck-cover-name" aria-hidden="true">My talk</span>',
  )
  const image = cover.indexOf('<img')
  expect(name).toBeGreaterThan(-1)
  expect(image).toBeGreaterThan(name)
  expect(cover).toMatch(/<img\s+data-cover\s+src="\/covers\/a\.jpg"\s+alt=""/)
  // The page policy runs no inline handler; /share.js hides a failed image.
  expect(cover).not.toContain('onerror')
})

test('F03-AC10: Given a deck without a cover image, When its cover is drawn, Then only the face with the name is there', async () => {
  const cover = String(await deckCover('My talk', null))
  expect(cover).toContain('>My talk</span>')
  expect(cover).not.toContain('<img')
})

test.each([
  ['<script>alert(1)</script>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
  ['"quoted" & more', '&quot;quoted&quot; &amp; more'],
  ['', ''],
  ['👩‍💻 絵文字', '👩‍💻 絵文字'],
])(
  'Given a deck named %j, When its card is drawn, Then the name is escaped on the face and under the cover',
  async (name, escaped) => {
    const card = String(
      await deckCard({ name, href: '/@a/b', coverUrl: '/covers/a.jpg' }),
    )
    expect(card.split(`>${escaped}</span>`).length).toBe(3)
    expect(card).toContain('<a class="card-title" href="/@a/b">')
    expect(card).not.toContain('class="card-meta"')
  },
)

test('Given a line about the deck, When its card is drawn, Then the line follows the link', async () => {
  const card = String(
    await deckCard(
      { name: 'n', href: '/@a/b', coverUrl: null },
      '2026年11月19日',
    ),
  )
  expect(card).toMatch(/<\/a>\s*<p class="card-meta">2026年11月19日<\/p>/)
})
