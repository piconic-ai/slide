import { expect, test } from 'vitest'
import { deviceLabel, storedDeviceLabel } from './device-label'

const name = (agent: string | null | undefined) =>
  storedDeviceLabel(deviceLabel(agent))

test.each([
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    'iPhone · Safari',
  ],
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
    'iPhone · Chrome',
  ],
  [
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'iPad · Safari',
  ],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mac · Chrome',
  ],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    'Mac · Safari',
  ],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:132.0) Gecko/20100101 Firefox/132.0',
    'Mac · Firefox',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    'Windows · Edge',
  ],
  [
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    'Android · Chrome',
  ],
  [
    'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
    'Android · Samsung Internet',
  ],
  [
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'ChromeOS · Chrome',
  ],
  [
    'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
    'Linux · Firefox',
  ],
])(
  'F28-AC108: Given the user agent %s, When it is named, Then the name is %s',
  (agent, expected) => {
    expect(name(agent)).toBe(expected)
  },
)

test.each([
  ['', null],
  [null, null],
  [undefined, null],
  ['curl/8.7.1', null],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Windows'],
  ['SomeBot/1.0 Firefox/1', 'Firefox'],
])(
  'F28-AC111: Given an unknown or partial user agent %j, When it is named, Then only what is known is kept',
  (agent, expected) => {
    expect(name(agent)).toBe(expected)
  },
)

test('F28-AC111: Given a user agent that names a system only after 512 characters, When it is named, Then the tail is not read', () => {
  expect(name(`${'x'.repeat(512)} (iPhone) Version/1 Safari/1`)).toBeNull()
})

test('F28-AC111: Given any user agent, When it is named, Then nothing of the agent but the rough name is kept', () => {
  const agent =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Version/18.1 Mobile/15E148 Safari/604.1 secret-id-1234'
  expect(name(agent)).toBe('iPhone · Safari')
})
