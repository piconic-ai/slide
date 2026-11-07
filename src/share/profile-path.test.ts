import { expect, test } from 'vitest'
import { parseSharePath, profilePath } from './path'

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
