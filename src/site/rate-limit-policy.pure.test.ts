import { expect, test } from 'vitest'
import { coverShotPath, pageShotPath } from '../covers/shot'
import { clientKey, limitGroupOf } from './rate-limit-policy'

test.each([
  ['/auth', 'auth'],
  ['/auth/github', 'auth'],
  ['/login', 'auth'],
  ['/login/code', 'auth'],
  ['/welcome', 'auth'],
  ['/auth/github/callback', 'auth'],
  ['/api/uploads', 'uploads'],
  ['/api/uploads/x/files/a.html', 'uploads'],
  ['/api/slides/talk/uploads', 'uploads'],
  ['/api/slides/talk/uploads/', 'uploads'],
  ['/api/slides', 'management'],
  ['/covers/7ae11c67-633f-4f21-b2b1-80af84107428.jpg', 'viewer'],
  ['/api/slides/talk/publication', 'management'],
  ['/api/slides/talk/uploads/extra', 'management'],
  ['/my/slides', 'management'],
  // The article beside the editing box is asked for after every pause in typing.
  ['/my/slides/talk/article/render', 'viewer'],
  ['/my/slides/talk/article/render/', 'viewer'],
  ['/my/slides/talk/article/autosave', 'management'],
  ['/my/slides/talk/article', 'management'],
  ['/my/slides/talk', 'management'],
  ['/', 'viewer'],
  ['/start', 'viewer'],
  ['/settings', 'management'],
  ['/api/session', 'viewer'],
  // F21-AC18: every visitor of the top page asks it, signed in or not.
  ['/api/home', 'viewer'],
  ['/api/home/', 'management'],
  // F31-AC3: asked by the top page like /api/home.
  ['/api/home/communities', 'viewer'],
  ['/api/home/communities/', 'management'],
  ['/api/homepage', 'management'],
  ['/api/public/slides', 'viewer'],
  ['/reports', 'management'],
  ['/reports/new', 'management'],
  ['/follows', 'management'],
  ['/follows/new', 'management'],
  ['/follows/author/release', 'management'],
  ['/communities/follows', 'management'],
  ['/communities/follows/release', 'management'],
  ['/communities/following', 'management'],
  ['/mutes', 'management'],
  ['/mutes/new', 'management'],
  ['/blocks', 'management'],
  ['/blocks/new', 'management'],
  ['/blocks/author/release', 'management'],
  ['/notifications', 'management'],
  ['/notifications/preferences', 'management'],
] as const)(
  'Given %s, When classified, Then it is limited as %s',
  (path, group) => {
    expect(limitGroupOf(path)).toBe(group)
  },
)

test.each([
  '/robots.txt',
  '/covers',
  '/uploads/x',
  '/authx',
  '/slidesx',
  '/apix',
  '/reportsx',
  '/followsx',
  '/communities/followsx',
  '/mutesx',
  '/blocksx',
  '/notificationsx',
  '',
])('Given %j, When classified, Then it is not limited', (path) => {
  expect(limitGroupOf(path)).toBeNull()
})

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

test('F05-AC13: Given the path of the image of a page, When its rate limit is chosen, Then it is the one a cover is counted under', () => {
  const id = '7ae11c67-633f-4f21-b2b1-80af84107428'

  expect(limitGroupOf(pageShotPath(id, 6))).toBe('viewer')
  expect(limitGroupOf(pageShotPath(id, 6))).toBe(
    limitGroupOf(coverShotPath(id)),
  )
})

test('F26-AC105: Given the editing page of an article, When its autosave and its preview are classified, Then autosave counts against the owner pages’ budget and the preview against reading', () => {
  expect(limitGroupOf('/my/slides/talk/article/autosave')).toBe('management')
  expect(limitGroupOf('/my/slides/talk/article/render')).toBe('viewer')
})
