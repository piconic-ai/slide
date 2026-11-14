import { expect, test } from 'vitest'
import { collectedFrom, defaultQuery } from './collect'

const ORIGIN = 'https://slide.example'
const DID = 'did:plc:z72i7hdynmk6r22z27h6tvur'
const DECK = { handle: 'kfly8', slug: 'talk' }
const uri = (rkey: string) => `at://${DID}/app.bsky.feed.post/${rkey}`

test('Given a share URL, When the default search is built, Then it is the URL without its scheme', () => {
  expect(defaultQuery(`${ORIGIN}/@kfly8/talk`)).toBe(
    'slide.example/@kfly8/talk',
  )
})

test('Given a post linking to a page of the deck, When collected, Then it reacts to that page at the time it was written', () => {
  const found = [
    {
      uri: uri('3l6oveex3ii2l'),
      record: {
        createdAt: '2026-09-03T10:00:00.000Z',
        facets: [{ features: [{ uri: `${ORIGIN}/@kfly8/talk/24` }] }],
      },
    },
  ]
  expect(collectedFrom(found, DECK, ORIGIN)).toEqual([
    {
      post: { service: 'bluesky', did: DID, rkey: '3l6oveex3ii2l' },
      page: 24,
      postedAt: 1788429600,
    },
  ])
})

test('Given a post whose link card names the page, When collected, Then the card counts as its link', () => {
  const found = [
    {
      uri: uri('3l6oveex3ii2l'),
      record: { embed: { external: { uri: `${ORIGIN}/@kfly8/talk/3` } } },
    },
  ]
  expect(collectedFrom(found, DECK, ORIGIN)[0]?.page).toBe(3)
})

test.each([
  ['no link', {}],
  [
    'a link to the deck itself',
    { facets: [{ features: [{ uri: `${ORIGIN}/@kfly8/talk` }] }] },
  ],
  [
    'a link to another deck',
    { facets: [{ features: [{ uri: `${ORIGIN}/@kfly8/other/5` }] }] },
  ],
  [
    'a link elsewhere',
    {
      facets: [
        { features: [{ uri: 'https://elsewhere.example/@kfly8/talk/5' }] },
      ],
    },
  ],
  ['a mention', { facets: [{ features: [{}] }] }],
])(
  'Given a post with %s, When collected, Then it reacts to the whole deck',
  (_, record) => {
    expect(
      collectedFrom([{ uri: uri('3l6oveex3ii2l'), record }], DECK, ORIGIN)[0]
        ?.page,
    ).toBe(0)
  },
)

test('Given a post without a written time, When collected, Then its record key tells the time', () => {
  const [collected] = collectedFrom(
    [{ uri: uri('3l6oveex3ii2l') }],
    DECK,
    ORIGIN,
  )
  expect(
    new Date((collected?.postedAt ?? 0) * 1000).toISOString().slice(0, 10),
  ).toBe('2024-10-17')
})

test('Given a post with an unreadable time and key, When collected, Then its time is unknown', () => {
  const found = [{ uri: uri('self'), record: { createdAt: 'yesterday' } }]
  expect(collectedFrom(found, DECK, ORIGIN)[0]?.postedAt).toBeNull()
})

test.each([
  'at://not-a-did/app.bsky.feed.post/3l6oveex3ii2l',
  `at://${DID}/app.bsky.feed.like/3l6oveex3ii2l`,
  `at://${DID}/app.bsky.feed.post/a/b`,
  `https://bsky.app/profile/${DID}/post/3l6oveex3ii2l`,
  '',
])('Given the address %j, When collected, Then it is left out', (address) => {
  expect(collectedFrom([{ uri: address }], DECK, ORIGIN)).toEqual([])
})

test('Given the same post twice, When collected, Then it is kept once', () => {
  const found = [{ uri: uri('3l6oveex3ii2l') }, { uri: uri('3l6oveex3ii2l') }]
  expect(collectedFrom(found, DECK, ORIGIN)).toHaveLength(1)
})

test('Given no posts, When collected, Then there is nothing', () => {
  expect(collectedFrom([], DECK, ORIGIN)).toEqual([])
})
