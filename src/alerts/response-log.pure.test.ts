import { expect, test } from 'vitest'
import { responseLogOf, type OriginKind } from './response-log'

const origins: OriginKind[] = ['management', 'content', 'operator']

test.each(origins)(
  'D-62: Given a 500, 502 or 599 on the %s origin, When it is logged, Then the line names the origin and the status and holds nothing else',
  (origin) => {
    for (const status of [500, 502, 599])
      expect(responseLogOf(origin, '/slides/secret-slide', status)).toEqual({
        event: 'http_5xx',
        origin,
        status,
      })
  },
)

test.each([200, 204, 301, 304, 400, 401, 403, 404, 410, 499])(
  'D-62: Given a %s, When it is logged, Then nothing is',
  (status) => {
    expect(responseLogOf('management', '/', status)).toBeNull()
  },
)

test.each([
  ['/login', 'auth'],
  ['/api/uploads/x', 'uploads'],
  ['/slides', 'management'],
  ['/covers/x', 'viewer'],
  ['/no-such-group', 'other'],
])(
  'D-62: Given a 429 on the management origin at %s, When it is logged, Then the kind of limit is %s',
  (path, group) => {
    expect(responseLogOf('management', path, 429)).toEqual({
      event: 'http_limited',
      origin: 'management',
      group,
      status: 429,
    })
  },
)

test('D-62: Given a 429 on the content origin, When it is logged, Then the limit is the content one whatever the path', () => {
  expect(responseLogOf('content', '/login', 429)).toMatchObject({
    group: 'content',
  })
})

test('D-62: Given a 429 on the operator origin, When it is logged, Then the limit is other', () => {
  expect(responseLogOf('operator', '/', 429)).toMatchObject({ group: 'other' })
})

test('D-62: Given paths that hold an address, a name or an IP address, When 5xx and 429 are logged, Then none of them is in the line', () => {
  for (const path of [
    '/@someone/slide',
    '/a@example.com',
    '/203.0.113.7',
    '/login?email=a@b.c',
  ])
    for (const status of [500, 429])
      expect(
        JSON.stringify(responseLogOf('management', path, status)),
      ).not.toMatch(/someone|@|203\.|slide"/)
})
