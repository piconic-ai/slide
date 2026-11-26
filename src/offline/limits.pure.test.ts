import { describe, expect, test } from 'vitest'
import {
  isHandledRequest,
  isVersionOrigin,
  isTopPagePath,
  STORED_AT_PLACEHOLDER,
  storedAtLine,
} from './limits'

const origin = 'https://d-1.content.example'

describe('isHandledRequest', () => {
  test.each([
    ['GET', `${origin}/`, true],
    ['GET', `${origin}/css/site.css?v=2`, true],
    ['GET', `${origin}/next/#3`, true],
    ['POST', `${origin}/`, false],
    ['HEAD', `${origin}/`, false],
    ['GET', `${origin}/_preview/sw.js`, false],
    ['GET', `${origin}/_preview/pages.js`, false],
    ['GET', `${origin}/_preview/evict`, false],
    ['GET', `https://elsewhere.example/`, false],
    ['GET', `https://d-2.content.example/`, false],
    ['GET', `${origin.replace('https', 'http')}/`, false],
    // A file that only starts with the same letters is the author's.
    ['GET', `${origin}/_previewer.js`, true],
  ])('F37-AC18: %s %s is handled: %s', (method, url, handled) => {
    expect(isHandledRequest({ method, url }, origin)).toBe(handled)
  })
})

test.each([
  ['/', true],
  ['/index.html', true],
  ['/next/', false],
  ['/next/index.html', false],
  ['/a/index.html', false],
])('Given the path %s, Then it is the top page: %s', (path, top) => {
  expect(isTopPagePath(path)).toBe(top)
})

describe('storedAtLine', () => {
  test('Given a time, Then the line differs from the placeholder in the time only', () => {
    expect(storedAtLine(1_700_000_000_123)).toBe(
      'const storedAt = 1700000000123 /*slide-stored-at*/',
    )
    expect(STORED_AT_PLACEHOLDER).toBe('const storedAt = 0 /*slide-stored-at*/')
  })

  test('Given a fraction or a nonsense time, Then only a number is written into the line', () => {
    expect(storedAtLine(12.9)).toBe('const storedAt = 12 /*slide-stored-at*/')
    expect(storedAtLine(Number.NaN)).toBe(
      'const storedAt = NaN /*slide-stored-at*/',
    )
  })
})

describe('isVersionOrigin', () => {
  const base = 'https://content.example'
  const id = '123e4567-e89b-12d3-a456-426614174000'

  test.each([
    [`https://d-${id}.content.example`, base, true],
    [`http://d-${id}.localhost:8787`, 'http://localhost:8787', true],
    // The domain must be the configured one, exactly.
    [`https://d-${id}.evil.example`, base, false],
    [`https://d-${id}.content.example.evil.example`, base, false],
    [`https://d-${id}.sub.content.example`, base, false],
    [`https://d-${id}.content.example:8443`, base, false],
    [`http://d-${id}.content.example`, base, false],
    [`https://d-${id}.localhost:9000`, 'http://localhost:8787', false],
    // The label must be a version's.
    ['https://d-1.content.example', base, false],
    [`https://x-${id}.content.example`, base, false],
    [`https://D-${id.toUpperCase()}.content.example`, base, false],
    [`https://content.example`, base, false],
    // Nothing beyond the origin.
    [`https://d-${id}.content.example/`, base, false],
    [`https://d-${id}.content.example/path`, base, false],
    [`https://d-${id}.content.example; script-src *`, base, false],
    [`https://user@d-${id}.content.example`, base, false],
    ['', base, false],
    [`https://d-${id}.content.example`, '', false],
    [`https://d-${id}.content.example`, 'not a url', false],
  ])(
    'Given %s under %s, Then it is a version origin: %s',
    (value, contentBase, expected) => {
      expect(isVersionOrigin(value, contentBase)).toBe(expected)
    },
  )
})
