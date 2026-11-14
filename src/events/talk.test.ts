import { expect, test } from 'vitest'
import {
  hashtagSchema,
  heldOnSchema,
  heldOnText,
  linkSchema,
  playerUrlOf,
  talkOf,
  type TalkRow,
} from './talk'

const row = (fields: Partial<TalkRow>): TalkRow => ({
  deckId: null,
  handle: null,
  deckTitle: null,
  deploymentId: null,
  title: null,
  speaker: null,
  url: null,
  embedUrl: null,
  ...fields,
})

test.each([
  'https://speakerdeck.com/player/a5877da0f6d34490ac573c4aca5e7203',
  'https://www.docswell.com/slide/5X23NX/embed',
])('Given the player %s, When checked, Then it may be framed', (url) => {
  expect(playerUrlOf(url)).toBe(url)
})

test.each([
  null,
  '',
  'https://speakerdeck.com/shuta13/some-talk',
  'https://speakerdeck.com/player/a5877da0f6d34490ac573c4aca5e7203/../../x',
  'https://speakerdeck.com.evil.example/player/a5877da0f6d34490ac573c4aca5e7203',
  'http://www.docswell.com/slide/5X23NX/embed',
  'https://www.docswell.com/slide/5X23NX/embed?x=1',
  'javascript:alert(1)',
])('Given %s, When checked, Then it is not framed', (url) => {
  expect(playerUrlOf(url)).toBeNull()
})

test('Given a public deck here, When read, Then the talk is that deck', () => {
  const talk = talkOf(
    row({
      deckId: 'talk',
      handle: 'owner',
      deckTitle: 'Talk',
      deploymentId: 'd',
    }),
  )

  expect(talk).toEqual({
    kind: 'deck',
    handle: 'owner',
    slug: 'talk',
    title: 'Talk',
    deploymentId: 'd',
  })
})

test.each([
  ['no public deployment', row({ deckId: 'talk', handle: 'owner' })],
  ['no handle', row({ deckId: 'talk', deploymentId: 'd' })],
  [
    'a deck that is not public, even with a link beside it',
    row({ deckId: 'talk', title: 'T', url: 'https://example.com/' }),
  ],
])('Given %s, When read, Then readers see no talk', (_, stored) => {
  expect(talkOf(stored)).toBeNull()
})

test('Given slides elsewhere with a known player, When read, Then the talk links there and names the player', () => {
  const talk = talkOf(
    row({
      title: ' DSL ',
      speaker: ' kazuhi-ra ',
      url: 'https://www.docswell.com/s/kazuhi-ra/5X23NX',
      embedUrl: 'https://www.docswell.com/slide/5X23NX/embed',
    }),
  )

  expect(talk).toEqual({
    kind: 'external',
    title: 'DSL',
    speaker: 'kazuhi-ra',
    url: 'https://www.docswell.com/s/kazuhi-ra/5X23NX',
    playerUrl: 'https://www.docswell.com/slide/5X23NX/embed',
  })
})

test('Given slides elsewhere with an unknown player, When read, Then the talk is a link only', () => {
  const talk = talkOf(
    row({
      title: 'T',
      url: 'https://example.com/slides',
      embedUrl: 'https://example.com/embed',
    }),
  )

  expect(talk).toMatchObject({
    kind: 'external',
    playerUrl: null,
    speaker: null,
  })
})

test.each([
  ['a script link', row({ title: 'T', url: 'javascript:alert(1)' })],
  ['a plain http link', row({ title: 'T', url: 'http://example.com/' })],
  ['no title', row({ url: 'https://example.com/' })],
  ['a blank title', row({ title: '  ', url: 'https://example.com/' })],
  ['nothing', row({})],
])(
  'Given slides elsewhere with %s, When read, Then readers see no talk',
  (_, stored) => {
    expect(talkOf(stored)).toBeNull()
  },
)

test.each(['kyotojs', 'yapcjapan', '技術書典', 'a_1'])(
  'Given the hashtag %s, When checked, Then it is accepted',
  (tag) => expect(hashtagSchema.safeParse(tag).success).toBe(true),
)

test.each(['', '#kyotojs', 'a b', 'a"onclick', 'x'.repeat(51)])(
  'Given the hashtag %s, When checked, Then it is refused',
  (tag) => expect(hashtagSchema.safeParse(tag).success).toBe(false),
)

test.each([
  '2026-9-3',
  '2026-13-01',
  '2026-00-10',
  '2026-09-32',
  '2026-02-31',
  '2026-04-31',
  '2027-02-29',
  'today',
  '',
])('Given the date %s, When checked, Then it is refused', (date) =>
  expect(heldOnSchema.safeParse(date).success).toBe(false),
)

test.each(['http://example.com/', 'javascript:alert(1)', '/path', ''])(
  'Given the link %s, When checked, Then it is refused',
  (link) => expect(linkSchema.safeParse(link).success).toBe(false),
)

test('Given a date, When worded, Then it reads in the reader’s language whatever the time zone', () => {
  expect(heldOnText('2026-09-03', 'ja')).toBe('2026年9月3日')
  expect(heldOnText('2026-09-03', 'en')).toBe('September 3, 2026')
})

test.each(['2026-09-03', '2028-02-29', '2026-12-31'])(
  'Given the date %s, When checked, Then it is accepted',
  (date) => expect(heldOnSchema.safeParse(date).success).toBe(true),
)
