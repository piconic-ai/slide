import { expect, test } from 'vitest'
import {
  initialOf,
  neighbourPages,
  parsePeoplePage,
  PEOPLE_PER_PAGE,
  rowFollowState,
  peopleReaderOf,
  type PeopleReader,
} from './people'

test('F21-AC19: Given no page is named, When it is read, Then it is the first page', () => {
  expect(parsePeoplePage(null)).toBe(1)
})

test.each([
  ['1', 1],
  ['2', 2],
  ['100000', 100_000],
])(
  'F21-AC19: Given ?page=%s, When it is read, Then it names page %i',
  (input, page) => {
    expect(parsePeoplePage(input)).toBe(page)
  },
)

test.each([
  '',
  '0',
  '-1',
  '01',
  '1.5',
  '1e3',
  ' 2',
  '2 ',
  'two',
  '100001',
  '9999999',
  '２',
])(
  'F21-AC19: Given ?page=%j, When it is read, Then it names no page',
  (input) => {
    expect(parsePeoplePage(input)).toBeNull()
  },
)

test.each([
  { page: 1, total: 0, previous: null, next: null },
  { page: 1, total: PEOPLE_PER_PAGE, previous: null, next: null },
  { page: 1, total: PEOPLE_PER_PAGE + 1, previous: null, next: 2 },
  { page: 2, total: PEOPLE_PER_PAGE + 1, previous: 1, next: null },
  { page: 2, total: 3 * PEOPLE_PER_PAGE, previous: 1, next: 3 },
  // Past the end: the way back leads to the last page that has people.
  { page: 9, total: PEOPLE_PER_PAGE + 1, previous: 2, next: null },
  { page: 9, total: 0, previous: 1, next: null },
])(
  'F21-AC19: Given page $page of $total people, When its neighbours are worked out, Then they are $previous and $next',
  ({ page, total, previous, next }) => {
    expect(neighbourPages(page, total)).toEqual({ previous, next })
  },
)

test.each([
  ['kobaken', 'K'],
  ['  spaced', 'S'],
  ['小林', '小'],
  ['😀 smile', '😀'],
  ['', '?'],
  ['   ', '?'],
])(
  'Given the name %j, When its initial is taken, Then it is %j',
  (name, initial) => {
    expect(initialOf(name)).toBe(initial)
  },
)

const STOPPED: PeopleReader = { kind: 'stopped' }
const SIGNED_OUT: PeopleReader = { kind: 'signed-out' }
const member = (userId: string): PeopleReader => ({ kind: 'member', userId })
test.each([
  { reader: STOPPED, userId: 'b', followed: false, state: 'none' },
  { reader: STOPPED, userId: 'b', followed: true, state: 'none' },
  { reader: SIGNED_OUT, userId: 'b', followed: false, state: 'signed-out' },
  { reader: member('a'), userId: 'a', followed: false, state: 'none' },
  // A follow of oneself cannot be stored; if one were, no button still.
  { reader: member('a'), userId: 'a', followed: true, state: 'none' },
  { reader: member('a'), userId: 'b', followed: false, state: 'can-follow' },
  { reader: member('a'), userId: 'b', followed: true, state: 'following' },
])(
  'F21-AC12: Given reader $reader.kind looks at $userId (followed: $followed), When the row’s state is worked out, Then it is $state',
  ({ reader, userId, followed, state }) => {
    expect(rowFollowState({ userId, followedByViewer: followed }, reader)).toBe(
      state,
    )
  },
)

test.each([
  [null, null, 'signed-out'],
  ['a', null, 'stopped'],
  ['a', 'a', 'member'],
])(
  'F21-AC42: Given the viewer %j and the active reader %j, When the page’s reader is worked out, Then it is %s',
  (viewer, active, kind) => {
    expect(peopleReaderOf(viewer, active).kind).toBe(kind)
  },
)
