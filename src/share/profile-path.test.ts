import { expect, test } from 'vitest'
import { handleSchema } from './handle'
import { parseSharePath, peoplePath, profilePath, returnToShare } from './path'

test('Given a canonical profile path, When parsed, Then it names the handle', () => {
  expect(parseSharePath('/@kfly8')).toEqual({
    kind: 'profile',
    handle: 'kfly8',
  })
})

test.each(['/@KFly8', '/@kfly8/', '/%40kfly8', '/@kfl%798'])(
  'Given %s, When parsed, Then it redirects to the canonical profile',
  (path) => {
    expect(parseSharePath(path)).toEqual({ kind: 'redirect', path: '/@kfly8' })
  },
)

test.each([
  '/@',
  '/@/',
  '/@-kfly8',
  '/@k_fly8',
  `/@${'a'.repeat(40)}`,
  '/@kfly8//',
])('Given %j, When parsed, Then it is not a profile', (path) => {
  expect(parseSharePath(path).kind).not.toBe('profile')
})

test('Given a handle, When the profile path is built, Then it parses back to it', () => {
  const parsed = parseSharePath('/@kfly8')
  if (parsed.kind !== 'profile') throw new Error('expected a profile')
  expect(profilePath(parsed.handle)).toBe('/@kfly8')
})

test.each(['following', 'followers'] as const)(
  'F21-AC20: Given /@kfly8/%s, When parsed, Then it names the list of people, never a deck',
  (list) => {
    expect(parseSharePath(`/@kfly8/${list}`)).toEqual({
      kind: 'people',
      handle: 'kfly8',
      list,
    })
    expect(peoplePath(handleSchema.parse('kfly8'), list)).toBe(
      `/@kfly8/${list}`,
    )
    expect(peoplePath(handleSchema.parse('kfly8'), list, 3)).toBe(
      `/@kfly8/${list}?page=3`,
    )
  },
)

test.each([
  ['/@KFly8/Following', '/@kfly8/following'],
  ['/@kfly8/followers/', '/@kfly8/followers'],
  ['/%40kfly8/f%6Fllowing', '/@kfly8/following'],
])(
  'F21-AC20: Given %s, When parsed, Then it redirects to the canonical list',
  (path, canonical) => {
    expect(parseSharePath(path)).toEqual({ kind: 'redirect', path: canonical })
  },
)

test.each([
  '/@kfly8/following/2',
  '/@kfly8/followers/1',
  '/@kfly8/following/x',
])(
  'F21-AC20: Given %s, When parsed, Then no page of a deck hides under a list’s name',
  (path) => {
    expect(parseSharePath(path)).toEqual({ kind: 'invalid' })
  },
)

test.each(['/@kfly8/following-talk', '/@kfly8/follower', '/@kfly8/followings'])(
  'F21-AC20: Given %s, When parsed, Then a name that only resembles a list is a deck',
  (path) => {
    expect(parseSharePath(path).kind).toBe('deck')
  },
)

test.each([
  ['/@kfly8/following', '/@kfly8/following'],
  ['/@kfly8/followers', '/@kfly8/followers'],
  ['/@kfly8/followers?page=2', '/slides'],
  ['/@kfly8/Followers', '/slides'],
])(
  'F21-AC12: Given a form sent from %s, When the way back is worked out, Then it is %s',
  (from, back) => {
    expect(returnToShare(from)).toBe(back)
  },
)
