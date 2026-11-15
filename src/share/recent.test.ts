import { expect, test } from 'vitest'
import { homePagePolicy } from '../decks/pages'
import { deckIdSchema } from '../decks/binding'
import { handleSchema } from './handle'
import { toRecentDeck } from './recent'

const deck = {
  handle: handleSchema.parse('owner'),
  slug: deckIdSchema.parse('talk'),
  title: 'Talk',
  readyAt: 100,
  deploymentId: '7ae11c67-633f-4f21-b2b1-80af84107428',
  coverPath: null,
}
const base = new URL('https://content.example')
const origin = 'https://d-7ae11c67-633f-4f21-b2b1-80af84107428.content.example'

test('Given a deck that names no cover image, When a recent deck is made, Then its cover is the one the service takes of the deployment', () => {
  expect(toRecentDeck(deck, base).coverUrl).toBe(
    '/covers/7ae11c67-633f-4f21-b2b1-80af84107428.jpg',
  )
})

test.each([
  ['cover.png', '/cover.png'],
  ['images/og image#1.png', '/images/og%20image%231.png'],
  ['表紙.webp', '/%E8%A1%A8%E7%B4%99.webp'],
])(
  'Given a deck whose cover image is %j, When a recent deck is made, Then its cover is that file on the deployment origin',
  (coverPath, path) => {
    expect(toRecentDeck({ ...deck, coverPath }, base).coverUrl).toBe(
      `${origin}${path}`,
    )
  },
)

test('Given no content origin, When a recent deck is made, Then it has no cover to load and keeps its links', () => {
  expect(toRecentDeck({ ...deck, coverPath: 'cover.png' }, null)).toEqual({
    name: 'Talk',
    href: '/@owner/talk',
    handle: 'owner',
    authorHref: '/@owner',
    publishedAt: '1970-01-01T00:01:40.000Z',
    coverUrl: null,
  })
})

test.each([
  ['https://content.example', 'https://*.content.example'],
  ['http://localhost:8794', 'http://*.localhost:8794'],
])(
  'Given the content origin %s, When the top page policy is made, Then images come only from the service and deployment origins, and nothing is framed',
  (contentOrigin, source) => {
    const policy = homePagePolicy(new URL(contentOrigin))

    expect(policy.split('; ')).toContain(`img-src 'self' ${source}`)
    expect(policy).not.toContain('frame-src')
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("frame-ancestors 'none'")
  },
)

test('Given no content origin, When the top page policy is made, Then no image may be loaded', () => {
  expect(homePagePolicy(null)).not.toContain('img-src')
})
