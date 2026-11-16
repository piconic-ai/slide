import { expect, test } from 'vitest'
import { kindOf, MAX_PATH_LENGTH, placeOf, reportedTraffic } from './traffic'

const OWN = ['d-1.content.example', 'slide.example']
const report = (blocked: unknown, directive?: string) => ({
  'csp-report': { 'blocked-uri': blocked, 'effective-directive': directive },
})

test.each([
  [
    'an image URL with a query',
    'https://images.elsewhere.example/a.png?x=1#top',
    'images.elsewhere.example',
    '/a.png',
  ],
  [
    'an origin alone, as a browser reports a frame of another site',
    'https://api.elsewhere.example',
    'api.elsewhere.example',
    '',
  ],
  ['an origin alone with a port', 'http://localhost:8765', 'localhost', ''],
  [
    'the root path',
    'https://api.elsewhere.example/',
    'api.elsewhere.example',
    '/',
  ],
  [
    'a query on no path',
    'https://api.elsewhere.example?x=1',
    'api.elsewhere.example',
    '/',
  ],
  [
    'a websocket',
    'wss://live.elsewhere.example/socket',
    'live.elsewhere.example',
    '/socket',
  ],
  [
    'a port and upper case',
    'HTTP://CDN.Elsewhere.Example:8080/X',
    'cdn.elsewhere.example',
    '/X',
  ],
  ['a trailing dot', 'https://elsewhere.example./x', 'elsewhere.example', '/x'],
  ['a local service', 'http://localhost:3000/admin', 'localhost', '/admin'],
  ['an IPv4 address', 'http://192.168.0.1/', '192.168.0.1', '/'],
  [
    'an underscore in a name',
    'https://my_bucket.example/a',
    'my_bucket.example',
    '/a',
  ],
  ['an IPv6 address', 'http://[::1]:8080/', '[::1]', '/'],
  [
    'a name in another script',
    'https://例え.example/',
    'xn--r8jz45g.example',
    '/',
  ],
  [
    'credentials in the URL',
    'https://user:secret@elsewhere.example/p',
    'elsewhere.example',
    '/p',
  ],
  [
    'a path that climbs',
    'https://elsewhere.example/a/../b',
    'elsewhere.example',
    '/b',
  ],
])(
  'Given %s, When its place is read, Then it is the host and the path without query, port or credentials',
  (_, url, host, path) => {
    expect(placeOf(url, OWN)).toEqual({ host, path })
  },
)

test.each([
  ['an inline resource', 'inline'],
  ['an eval', 'eval'],
  ['a data URL', 'data:text/plain,hello'],
  ['a blob', 'blob:https://d-1.content.example/1'],
  ['a scheme alone', 'https'],
  ['a file', 'file:///etc/passwd'],
  ['the slide’s own host', 'https://d-1.content.example/img/a.png'],
  ['the slide’s own host in upper case', 'https://D-1.CONTENT.EXAMPLE/a'],
  ['Slide itself', 'https://slide.example/api/slides'],
  ['markup as a host', 'https://<script>alert(1)</script>.example/'],
  ['no host', 'https://'],
  ['a host with a space', 'https://a b.example/'],
])(
  'Given %s, When its place is read, Then it names no other host',
  (_, url) => {
    expect(placeOf(url, OWN)).toBeNull()
  },
)

test('Given a path longer than is kept, When its place is read, Then the path is cut', () => {
  const place = placeOf(`https://a.example/${'a'.repeat(500)}`, OWN)
  expect(place?.path).toHaveLength(MAX_PATH_LENGTH)
})

test.each([
  ['script-src-elem', 'script'],
  ['script-src', 'script'],
  ['style-src-elem', 'style'],
  ['img-src', 'image'],
  ['font-src', 'font'],
  ['connect-src', 'data'],
  ['frame-src', 'frame'],
  ['media-src', 'media'],
  ["default-src 'self' data:", 'other'],
  ["img-src 'self'", 'image'],
  ['', 'other'],
  [undefined, 'other'],
  ['<script>', 'other'],
  ['__proto__', 'other'],
])(
  'Given the directive %s, When read, Then the kind is %s',
  (directive, kind) => {
    expect(kindOf(directive)).toBe(kind)
  },
)

test('Given a browser’s report, When read, Then it tells the kind, host and path, and no page', () => {
  expect(
    reportedTraffic(
      report('https://fonts.elsewhere.example/s/a.woff2?v=3', 'font-src'),
      OWN,
    ),
  ).toEqual({
    kind: 'font',
    host: 'fonts.elsewhere.example',
    path: '/s/a.woff2',
    page: -1,
  })
})

test('Given a report that names only the violated directive, When read, Then the kind comes from it', () => {
  const body = {
    'csp-report': {
      'blocked-uri': 'https://a.example/x.js',
      'violated-directive': "script-src-elem 'self'",
    },
  }
  expect(reportedTraffic(body, OWN)?.kind).toBe('script')
})

test.each([
  ['nothing', null],
  ['text', 'https://a.example/'],
  ['no report', {}],
  ['a report without a blocked URL', { 'csp-report': {} }],
  ['a blocked URL that is not text', report(42)],
  ['an empty blocked URL', report('')],
  ['an inline violation', report('inline', 'script-src-elem')],
  ['a directive that is not text', report('https://a.example/', 42 as never)],
])('Given %s, When read as a report, Then it tells nothing', (_, body) => {
  expect(reportedTraffic(body, OWN)).toBeNull()
})

test('Given a report whose URL has a very long query, When read, Then the report is kept without the query', () => {
  const blocked = `https://a.example/x.js?${'a'.repeat(6000)}`
  expect(reportedTraffic(report(blocked, 'script-src-elem'), OWN)).toEqual({
    kind: 'script',
    host: 'a.example',
    path: '/x.js',
    page: -1,
  })
})
