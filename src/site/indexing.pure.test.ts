import { expect, test } from 'vitest'
import { isIndexablePath, ROBOTS_TXT } from './indexing'

test('Given the top page or robots.txt, When checked, Then it may be indexed', () => {
  expect(isIndexablePath('/')).toBe(true)
  expect(isIndexablePath('/robots.txt')).toBe(true)
  expect(isIndexablePath('/help')).toBe(true)
  expect(isIndexablePath('/help/bot')).toBe(true)
})

test.each([
  '/my/slides',
  '/my/slides/talk',
  '/my/communities',
  '/settings',
  '/api/slides',
  '/auth/github',
  '/uploads/x',
  '',
  '/missing',
  '/help/missing',
])('Given %j, When checked, Then it is not indexed', (path) => {
  expect(isIndexablePath(path)).toBe(false)
})

test('Given robots.txt, When read, Then every private prefix is disallowed and the top page is not', () => {
  const lines = ROBOTS_TXT.split('\n')
  expect(lines[0]).toBe('User-agent: *')
  for (const prefix of ['/api/', '/auth/', '/my/', '/settings', '/uploads/'])
    expect(lines).toContain(`Disallow: ${prefix}`)
  expect(lines).not.toContain('Disallow: /')
})
