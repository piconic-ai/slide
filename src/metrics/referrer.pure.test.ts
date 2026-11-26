import { expect, test } from 'vitest'
import { ownHostsOf, referrerOf } from './referrer'

const own = ownHostsOf({
  publicOrigin: 'https://slide.example',
  operatorOrigin: 'https://admin.slide.example',
  contentOrigin: 'https://content.example',
})

test.each([
  ['https://news.example/a/b?q=secret#frag', 'news.example'],
  ['https://News.Example:8443/path', 'news.example'],
  ['http://user:pass@blog.example/x', 'blog.example'],
  ['https://sub.news.example./', 'sub.news.example'],
  ['https://xn--eckwd4c7c.example/', 'xn--eckwd4c7c.example'],
])(
  'F40-AC10: Given the referrer %s, When it is kept, Then only the host name %s remains',
  (header, host) => {
    expect(referrerOf(header, own)).toBe(host)
  },
)

test.each([
  'https://slide.example/@owner/talk?x=1',
  'https://admin.slide.example/metrics',
  'https://content.example/',
  'https://d-0123.content.example/index.html',
])(
  'F40-AC10: Given a move from the service itself (%s), When it is kept, Then it is counted as internal',
  (header) => {
    expect(referrerOf(header, own)).toBe('internal')
  },
)

test.each([
  undefined,
  null,
  '',
  'not a url',
  'ftp://files.example/x',
  'android-app://com.example.app/',
  'javascript:alert(1)',
  'https://203.0.113.9/path',
  'http://10.0.0.1:8080/',
  'https://[2001:db8::1]/x',
  'https://[::1]/',
  'http://0x7f.1/',
  'http://3232235777/',
  'https://under_score.example/',
])(
  'F40-AC10, F40-AC15: Given the unusable or IP-address referrer %s, When it is kept, Then nothing is kept',
  (header) => {
    expect(referrerOf(header, own)).toBe('')
  },
)

test('F40-AC10: Given a similar but foreign host, When it is kept, Then it is not taken for the service', () => {
  expect(referrerOf('https://slide.example.evil.test/', own)).toBe(
    'slide.example.evil.test',
  )
  expect(referrerOf('https://evilcontent.example/', own)).toBe(
    'evilcontent.example',
  )
})

test('F40-AC10: Given origins that cannot be read, When the own hosts are made, Then they are left out and no referrer is called internal', () => {
  const none = ownHostsOf({
    publicOrigin: 'nonsense',
    operatorOrigin: undefined,
    contentOrigin: '',
  })
  expect(none).toEqual({ hosts: [], families: [] })
  expect(referrerOf('https://slide.example/', none)).toBe('slide.example')
})
