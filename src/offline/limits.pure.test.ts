import { describe, expect, test } from 'vitest'
import {
  isHandledRequest,
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
