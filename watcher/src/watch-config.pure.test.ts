import { expect, test } from 'vitest'
import { parseSettings, parseTargets } from './watch-config'

const urls = {
  top: 'https://slide.community/',
  viewer: 'https://slide.community/@healthcheck/watcher',
  content: 'https://d-healthcheck.slideusercontent.com/',
}

test('F39-AC12: Given the three addresses, When they are read, Then top, viewer and content are checked', () => {
  expect(parseTargets(urls)).toEqual(urls)
})

test.each([
  ['missing', undefined],
  ['not an object', 'https://slide.community/'],
  ['one missing', { top: urls.top, viewer: urls.viewer }],
  ['an extra one', { ...urls, extra: 'https://example.com/' }],
  ['plain http on a real host', { ...urls, top: 'http://slide.community/' }],
  [
    'http on a host that only starts like localhost',
    { ...urls, top: 'http://localhost.example.com/' },
  ],
  ['http on 127.0.0.1', { ...urls, top: 'http://127.0.0.1:8787/' }],
  ['with user information', { ...urls, top: 'https://a:b@slide.community/' }],
  ['with a port', { ...urls, top: 'https://slide.community:8443/' }],
  ['not an address', { ...urls, viewer: 'slide.community' }],
])(
  'F39-AC12: Given addresses that are %s, When they are read, Then nothing is checked',
  (_, input) => {
    expect(parseTargets(input)).toBeNull()
  },
)

test('F39-AC16: Given no setting, When the settings are read, Then they are D-57 and D-58 numbers', () => {
  expect(parseSettings(undefined)).toEqual({
    failuresToTell: 2,
    throttleSeconds: 3600,
    timeoutMs: 5000,
  })
})

test('F39-AC16: Given failuresToTell of 4, When the settings are read, Then it changes and the rest stay', () => {
  expect(parseSettings({ failuresToTell: 4 })).toEqual({
    failuresToTell: 4,
    throttleSeconds: 3600,
    timeoutMs: 5000,
  })
})

test.each([
  ['zero', { failuresToTell: 0 }],
  ['fractional', { failuresToTell: 1.5 }],
  ['an unknown name', { failuresToTell: 4, failures: 1 }],
  ['a throttle under a minute', { throttleSeconds: 10 }],
  ['a timeout over 25 seconds', { timeoutMs: 60_000 }],
  ['a string', { failuresToTell: '2' }],
])(
  'F39-AC16: Given a setting with %s, When it is read, Then every default is used',
  (_, input) => {
    expect(parseSettings(input)).toEqual({
      failuresToTell: 2,
      throttleSeconds: 3600,
      timeoutMs: 5000,
    })
  },
)

test('F39-AC12: Given addresses on localhost over http, When they are read, Then they may be watched, for trying the watcher on one machine', () => {
  const local = {
    top: 'http://localhost:8787/',
    viewer: 'http://localhost:8787/@h/s',
    content: 'http://localhost:8787/',
  }
  expect(parseTargets(local)).toEqual(local)
})
