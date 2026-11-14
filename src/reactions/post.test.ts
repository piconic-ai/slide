import { expect, test } from 'vitest'
import {
  embedUrl,
  parsePostUrl,
  postedAtOf,
  postKey,
  postOfKey,
  postUrl,
} from './post'

const DID = 'did:plc:z72i7hdynmk6r22z27h6tvur'

test.each([
  'https://x.com/kfly8/status/1830000000000000000',
  'https://twitter.com/kfly8/status/1830000000000000000',
  'https://mobile.twitter.com/kfly8/status/1830000000000000000/',
  'https://x.com/i/web/status/1830000000000000000',
  'https://x.com/kfly8/status/1830000000000000000?s=20&t=abc',
  '  https://x.com/kfly8/status/1830000000000000000  ',
])('Given the X post URL %s, When parsed, Then it names the status', (url) => {
  expect(parsePostUrl(url)).toEqual({
    service: 'x',
    id: '1830000000000000000',
  })
})

test('Given a Bluesky post URL with a handle, When parsed, Then the handle is lowercased for resolution', () => {
  expect(
    parsePostUrl('https://bsky.app/profile/Bsky.App/post/3l6oveex3ii2l'),
  ).toEqual({
    service: 'bluesky',
    actor: { kind: 'handle', handle: 'bsky.app' },
    rkey: '3l6oveex3ii2l',
  })
})

test('Given a Bluesky post URL with a DID, When parsed, Then no resolution is needed', () => {
  expect(
    parsePostUrl(`https://bsky.app/profile/${DID}/post/3l6oveex3ii2l`),
  ).toEqual({
    service: 'bluesky',
    actor: { kind: 'did', did: DID },
    rkey: '3l6oveex3ii2l',
  })
})

test.each([
  ['an empty value', ''],
  ['plain text', 'not a url'],
  ['a profile on X', 'https://x.com/kfly8'],
  ['a zero-padded status', 'https://x.com/kfly8/status/0123'],
  ['a status with letters', 'https://x.com/kfly8/status/12ab'],
  ['a status with a suffix', 'https://x.com/kfly8/status/123/photo/1'],
  ['http', 'http://x.com/kfly8/status/123'],
  ['a lookalike host', 'https://x.com.evil.example/kfly8/status/123'],
  ['credentials in the URL', 'https://user@x.com/kfly8/status/123'],
  ['a port', 'https://x.com:8443/kfly8/status/123'],
  ['a Bluesky profile', 'https://bsky.app/profile/bsky.app'],
  ['a Bluesky feed', 'https://bsky.app/profile/bsky.app/feed/whats-hot'],
  ['a handle without a dot', 'https://bsky.app/profile/localhost/post/3l6o'],
  ['a script URL', 'javascript:alert(1)'],
])('Given %s, When parsed, Then it is not a post', (_, url) => {
  expect(parsePostUrl(url)).toBeNull()
})

test('Given a post, When its key is stored and read back, Then it is the same post', () => {
  const x = { service: 'x', id: '1830000000000000000' } as const
  const bluesky = {
    service: 'bluesky',
    did: DID,
    rkey: '3l6oveex3ii2l',
  } as const
  expect(postOfKey('x', postKey(x))).toEqual(x)
  expect(postOfKey('bluesky', postKey(bluesky))).toEqual(bluesky)
})

test.each([
  ['x', ''],
  ['x', '0123'],
  ['x', '12/34'],
  ['x', '"><script>'],
  ['bluesky', DID],
  ['bluesky', `${DID}/a/b`],
  ['bluesky', 'did:plc:short/3l6oveex3ii2l'],
  ['bluesky', `${DID}/"onload=`],
] as const)(
  'Given the stored %s key %j, When read back, Then it is refused',
  (service, key) => {
    expect(postOfKey(service, key)).toBeNull()
  },
)

test('Given posts, When their pages are built, Then the embed comes from the service and the link opens the post', () => {
  const x = { service: 'x', id: '20' } as const
  const bluesky = {
    service: 'bluesky',
    did: DID,
    rkey: '3l6oveex3ii2l',
  } as const
  expect(embedUrl(x)).toBe(
    'https://platform.twitter.com/embed/Tweet.html?id=20&dnt=true',
  )
  expect(postUrl(x)).toBe('https://x.com/i/status/20')
  expect(embedUrl(bluesky)).toBe(
    `https://embed.bsky.app/embed/${DID}/app.bsky.feed.post/3l6oveex3ii2l`,
  )
  expect(postUrl(bluesky)).toBe(
    `https://bsky.app/profile/${DID}/post/3l6oveex3ii2l`,
  )
})

test('Given an X status ID, When its time is read, Then it is the time the ID encodes', () => {
  // 1830000000000000000 >> 22, plus the X epoch, is 2024-08-31T21:49:34Z.
  expect(postedAtOf({ service: 'x', id: '1830000000000000000' })).toBe(
    1725140974,
  )
})

test.each(['20', '20000000000', '362000000000000'])(
  'Given the X status ID %s from before timestamped IDs, When its time is read, Then it is unknown',
  (id) => {
    expect(postedAtOf({ service: 'x', id })).toBeNull()
  },
)

test('Given a Bluesky record key, When its time is read, Then it is the time the key encodes', () => {
  const seconds = postedAtOf({
    service: 'bluesky',
    did: DID,
    rkey: '3l6oveex3ii2l',
  })
  // The post was made on 2024-10-17.
  expect(new Date((seconds ?? 0) * 1000).toISOString().slice(0, 10)).toBe(
    '2024-10-17',
  )
})

test('Given a Bluesky record key that is not a timestamp, When its time is read, Then it is unknown', () => {
  expect(postedAtOf({ service: 'bluesky', did: DID, rkey: 'self' })).toBeNull()
  expect(
    postedAtOf({ service: 'bluesky', did: DID, rkey: 'zzzzzzzzzzzzz' }),
  ).toBeNull()
})
