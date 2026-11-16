import { expect, test } from 'vitest'
import { reportedHost } from './reported-host'

const OWN = 'd-1.content.example'
const report = (blocked: unknown) => ({
  'csp-report': { 'blocked-uri': blocked },
})

test.each([
  [
    'an image URL',
    'https://images.elsewhere.example/a.png?x=1',
    'images.elsewhere.example',
  ],
  ['an origin alone', 'https://api.elsewhere.example', 'api.elsewhere.example'],
  [
    'a websocket',
    'wss://live.elsewhere.example/socket',
    'live.elsewhere.example',
  ],
  [
    'a port and upper case',
    'HTTP://CDN.Elsewhere.Example:8080/x',
    'cdn.elsewhere.example',
  ],
  ['a trailing dot', 'https://elsewhere.example./x', 'elsewhere.example'],
  ['a local service', 'http://localhost:3000/admin', 'localhost'],
  ['an IPv4 address', 'http://192.168.0.1/', '192.168.0.1'],
  ['an IPv6 address', 'http://[::1]:8080/', '[::1]'],
  ['a name in another script', 'https://例え.example/', 'xn--r8jz45g.example'],
  [
    'credentials in the URL',
    'https://user:secret@elsewhere.example/',
    'elsewhere.example',
  ],
])(
  'Given a report of %s, When read, Then it names the host',
  (_, blocked, host) => {
    expect(reportedHost(report(blocked), OWN)).toBe(host)
  },
)

test.each([
  ['inline code', 'inline'],
  ['eval', 'eval'],
  ['a data URL', 'data'],
  ['a data URL in full', 'data:image/png;base64,AAAA'],
  ['a blob URL', 'blob:https://elsewhere.example/1'],
  ['a script URL', 'javascript:alert(1)'],
  ['a file URL', 'file:///etc/passwd'],
  ['a bare name', 'elsewhere.example'],
  ['an empty value', ''],
  ['a number', 1],
  ['the slide’s own host', `https://${OWN}/img/dot.svg`],
  ['the slide’s own host in upper case', `https://${OWN.toUpperCase()}/`],
  ['a name longer than DNS allows', `https://${'a'.repeat(250)}.example/`],
  [
    'a value longer than a report holds',
    `https://elsewhere.example/${'a'.repeat(4096)}`,
  ],
])('Given a report of %s, When read, Then it names no host', (_, blocked) => {
  expect(reportedHost(report(blocked), OWN)).toBeNull()
})

test.each([
  ['nothing', null],
  ['a string', 'https://elsewhere.example/'],
  ['an empty object', {}],
  ['a report without a blocked URL', { 'csp-report': {} }],
  ['a list of reports', [report('https://elsewhere.example/')]],
])('Given a body that is %s, When read, Then it names no host', (_, body) => {
  expect(reportedHost(body, OWN)).toBeNull()
})
