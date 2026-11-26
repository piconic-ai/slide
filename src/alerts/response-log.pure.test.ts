import { expect, test } from 'vitest'
import { responseLogOf, type OriginKind } from './response-log'

const origins: OriginKind[] = ['management', 'content', 'operator']

test.each(origins)(
  'D-62: Given a 500, 502 or 599 on the %s origin, When it is logged, Then the line names the origin and the status and holds nothing else',
  (origin) => {
    for (const status of [500, 502, 599])
      expect(responseLogOf(origin, '/my/slides/secret-slide', status)).toEqual({
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
  ['/my/slides', 'management'],
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

test.each(origins)(
  'D-62: Given a 503 the service meant on the %s origin, When it is logged, Then it is http_unavailable and not a 5xx',
  (origin) => {
    expect(responseLogOf(origin, '/', 503, true)).toEqual({
      event: 'http_unavailable',
      origin,
    })
  },
)

test('D-62: Given a 503 the service did not mean, When it is logged, Then it is a 5xx', () => {
  expect(responseLogOf('management', '/', 503, false)).toEqual({
    event: 'http_5xx',
    origin: 'management',
    status: 503,
  })
})

test.each([500, 502, 504])(
  'D-62: Given a %s marked as meant, When it is logged, Then it is still a 5xx: only a 503 can be meant',
  (status) => {
    expect(responseLogOf('management', '/', status, true)).toMatchObject({
      event: 'http_5xx',
    })
  },
)
