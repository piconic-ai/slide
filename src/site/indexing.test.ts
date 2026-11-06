import { expect, test } from 'vitest'
import { isIndexablePath, ROBOTS_TXT } from './indexing'

test('Given the top page or robots.txt, When checked, Then it may be indexed', () => {
  expect(isIndexablePath('/')).toBe(true)
  expect(isIndexablePath('/robots.txt')).toBe(true)
})

test.each([
  '/decks',
  '/decks/talk',
  '/api/decks',
  '/auth/github',
  '/uploads/x',
  '',
  '/missing',
])('Given %j, When checked, Then it is not indexed', (path) => {
  expect(isIndexablePath(path)).toBe(false)
})

test('Given robots.txt, When read, Then every private prefix is disallowed and the top page is not', () => {
  const lines = ROBOTS_TXT.split('\n')
  expect(lines[0]).toBe('User-agent: *')
  for (const prefix of ['/api/', '/auth/', '/decks', '/uploads/'])
    expect(lines).toContain(`Disallow: ${prefix}`)
  expect(lines).not.toContain('Disallow: /')
})
