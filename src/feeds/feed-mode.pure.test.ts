import { expect, test } from 'vitest'
import { feedModeOf } from './feed-mode'

test.each([
  [undefined, 'https://slide.community', 'luma'],
  ['', 'https://slide.community', 'luma'],
  ['on', 'https://slide.community', 'off'],
  ['off', 'https://slide.community', 'off'],
  ['on', 'http://localhost:8770', 'mock'],
  ['on', 'https://localhost:8794', 'mock'],
  ['on', 'http://127.0.0.1:8770', 'mock'],
  ['ON', 'http://localhost:8770', 'off'],
  ['yes', 'http://localhost:8770', 'off'],
  [undefined, 'http://localhost:8770', 'off'],
  ['on', 'https://slide.example', 'off'],
  [undefined, 'https://slide.example', 'off'],
  ['on', 'http://localhost.evil.example', 'off'],
  ['on', 'http://evil.example/?localhost', 'off'],
  [undefined, 'https://slide.community.evil.example', 'off'],
  [undefined, 'https://slide.community/', 'off'],
  [undefined, 'not a url', 'off'],
] as const)(
  'F33-AC15: Given LUMA_FEED_MOCK %o on %s, When the mode is read, Then it is %s',
  (mock, publicOrigin, mode) => {
    expect(feedModeOf({ mock, publicOrigin })).toBe(mode)
  },
)
