import { expect, test } from 'vitest'
import { ownDeckName, toOwnDeck, type OwnDeckRow } from './own-decks'

const row = (changes: Partial<OwnDeckRow> = {}): OwnDeckRow => ({
  slug: 'talk',
  created_at: 10,
  public_deployment_id: null,
  paused_at: null,
  hidden_at: null,
  shown_id: null,
  shown_title: null,
  shown_cover_path: null,
  newest_ready_at: null,
  ...changes,
})

test.each([
  ['never published', {}, false],
  ['public', { public_deployment_id: 'd1' }, true],
  [
    'public but hidden by an operator',
    { public_deployment_id: 'd1', hidden_at: 5 },
    false,
  ],
  // A paused deck holds no public pointer, but the two are told apart anyway.
  ['paused', { paused_at: 5 }, false],
  [
    'a public pointer beside a pause',
    { public_deployment_id: 'd1', paused_at: 5 },
    false,
  ],
] as const)(
  'Given a slide that is %s, When it is told for the list, Then readers can open it: %s',
  (_state, changes, isPublic) => {
    expect(toOwnDeck(row(changes)).isPublic).toBe(isPublic)
  },
)

test('Given a slide nothing was received for, When it is told for the list, Then it shows no version, is named by its URL name and dated by its creation', () => {
  const deck = toOwnDeck(row())
  expect(deck.shown).toBeNull()
  expect(ownDeckName(deck)).toBe('talk')
  expect(deck.updatedAt).toBe(10)
})

test.each([
  ['a title', 'My <b>talk</b>', 'My <b>talk</b>'],
  ['no title', null, 'talk'],
  // An empty title is a title the author gave; it is not replaced.
  ['an empty title', '', ''],
])(
  'Given a slide whose shown version has %s, When it is named, Then the name is %j',
  (_case, title, name) => {
    const deck = toOwnDeck(
      row({ shown_id: 'd1', shown_title: title, newest_ready_at: 20 }),
    )
    expect(ownDeckName(deck)).toBe(name)
    expect(deck.updatedAt).toBe(20)
  },
)
