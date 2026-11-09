import { expect, test } from 'vitest'
import { clientKey, limitGroupOf } from './rate-limit-policy'

test.each([
  ['/auth', 'auth'],
  ['/auth/github', 'auth'],
  ['/auth/github/callback', 'auth'],
  ['/api/uploads', 'uploads'],
  ['/api/uploads/x/files/a.html', 'uploads'],
  ['/api/decks/talk/uploads', 'uploads'],
  ['/api/decks/talk/uploads/', 'uploads'],
  ['/api/decks', 'management'],
  ['/api/decks/talk/publication', 'management'],
  ['/api/decks/talk/uploads/extra', 'management'],
  ['/decks', 'management'],
  ['/decks/talk', 'management'],
  ['/', 'viewer'],
  ['/api/public/decks', 'viewer'],
] as const)(
  'Given %s, When classified, Then it is limited as %s',
  (path, group) => {
    expect(limitGroupOf(path)).toBe(group)
  },
)

test.each(['/robots.txt', '/uploads/x', '/authx', '/decksx', '/apix', ''])(
  'Given %j, When classified, Then it is not limited',
  (path) => {
    expect(limitGroupOf(path)).toBeNull()
  },
)

test.each([
  ['192.0.2.1', '192.0.2.1'],
  ['2001:db8:1:2:3:4:5:6', '2001:0db8:0001:0002::/64'],
  ['2001:db8:1:2::9', '2001:0db8:0001:0002::/64'],
  ['2001:DB8:1:2:ffff::1', '2001:0db8:0001:0002::/64'],
  ['2001:db8::1', '2001:0db8:0000:0000::/64'],
  ['::1', '0000:0000:0000:0000::/64'],
  ['::ffff:192.0.2.7', '192.0.2.7'],
] as const)('Given %s, When keyed, Then it is counted as %s', (ip, key) => {
  expect(clientKey(ip)).toBe(key)
})

test('Given two addresses in one IPv6 /64, When keyed, Then they share a budget', () => {
  expect(clientKey('2001:db8:a:b::1')).toBe(clientKey('2001:db8:a:b:c:d:e:f'))
  expect(clientKey('2001:db8:a:b::1')).not.toBe(clientKey('2001:db8:a:c::1'))
})
