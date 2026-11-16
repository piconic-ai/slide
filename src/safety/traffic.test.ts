import { expect, test } from 'vitest'
import {
  kindOf,
  MAX_PATH_LENGTH,
  placeOf,
  reportedTraffic,
  sentTraffic,
  TRAFFIC_PER_REQUEST,
} from './traffic'

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
    'an origin alone',
    'https://api.elsewhere.example',
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
  ['a blocked URL too long', report(`https://a.example/${'a'.repeat(5000)}`)],
  ['an inline violation', report('inline', 'script-src-elem')],
  ['a directive that is not text', report('https://a.example/', 42 as never)],
])('Given %s, When read as a report, Then it tells nothing', (_, body) => {
  expect(reportedTraffic(body, OWN)).toBeNull()
})

const item = (url: unknown, directive: unknown, page: unknown) => ({
  url,
  directive,
  page,
})

test('Given what the page script noticed, When read, Then each record tells its kind, place and page, and one without a directive is a sighting', () => {
  expect(
    sentTraffic(
      {
        traffic: [
          item('https://a.example/x.js?v=1', 'script-src-elem', 3),
          item('https://a.example/x.css', '', 0),
          item('https://a.example/y', 'connect-src', -1),
          item('https://a.example/z', 'unheard-of-src', 9999),
        ],
      },
      OWN,
    ),
  ).toEqual([
    { kind: 'script', host: 'a.example', path: '/x.js', page: 3 },
    { kind: 'seen', host: 'a.example', path: '/x.css', page: 0 },
    { kind: 'data', host: 'a.example', path: '/y', page: -1 },
    { kind: 'other', host: 'a.example', path: '/z', page: 9999 },
  ])
})

test.each([
  ['a page below unknown', item('https://a.example/', 'img-src', -2)],
  ['a page past the last', item('https://a.example/', 'img-src', 10000)],
  ['a page that is a fraction', item('https://a.example/', 'img-src', 1.5)],
  ['a page that is text', item('https://a.example/', 'img-src', '1')],
  ['no page', { url: 'https://a.example/', directive: 'img-src' }],
  ['no directive', { url: 'https://a.example/', page: 1 }],
  ['a directive too long', item('https://a.example/', 'a'.repeat(101), 1)],
  ['a URL that is not text', item(42, 'img-src', 1)],
  ['the slide’s own host', item('https://d-1.content.example/a', 'img-src', 1)],
  ['an inline resource', item('inline', 'script-src-elem', 1)],
  ['nothing', null],
])(
  'Given %s among what the page script noticed, When read, Then it is left out and the rest is kept',
  (_, bad) => {
    const good = item('https://kept.example/', 'img-src', 1)
    expect(sentTraffic({ traffic: [bad, good] }, OWN)).toEqual([
      { kind: 'image', host: 'kept.example', path: '/', page: 1 },
    ])
  },
)

test.each([
  ['nothing', null],
  ['no list', {}],
  ['a list that is not one', { traffic: 'https://a.example/' }],
  ['a browser’s report', report('https://a.example/', 'img-src')],
])(
  'Given %s, When read as the page script’s post, Then it tells nothing',
  (_, body) => {
    expect(sentTraffic(body, OWN)).toEqual([])
  },
)

test('Given more records than a request may carry, When read, Then only the first are taken', () => {
  const traffic = Array.from({ length: TRAFFIC_PER_REQUEST + 1 }, (_, index) =>
    item(`https://h${index}.example/`, 'img-src', 1),
  )
  const read = sentTraffic({ traffic }, OWN)
  expect(read).toHaveLength(TRAFFIC_PER_REQUEST)
  expect(read.at(-1)?.host).toBe(`h${TRAFFIC_PER_REQUEST - 1}.example`)
})
