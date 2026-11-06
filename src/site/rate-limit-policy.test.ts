import { expect, test } from 'vitest'
import { limitGroupOf } from './rate-limit-policy'

test.each([
  ['/auth', 'auth'],
  ['/auth/github', 'auth'],
  ['/auth/github/callback', 'auth'],
  ['/api/uploads', 'uploads'],
  ['/api/uploads/x/files/a.html', 'uploads'],
  ['/api/decks/talk/uploads', 'uploads'],
  ['/api/decks/talk/uploads/', 'uploads'],
  ['/api/decks', 'management'],
  ['/api/decks/talk/publication', 'management'],
  ['/api/decks/talk/uploads/extra', 'management'],
  ['/decks', 'management'],
  ['/decks/talk', 'management'],
] as const)(
  'Given %s, When classified, Then it is limited as %s',
  (path, group) => {
    expect(limitGroupOf(path)).toBe(group)
  },
)

test.each(['/', '/robots.txt', '/uploads/x', '/authx', '/decksx', '/apix', ''])(
  'Given %j, When classified, Then it is not limited',
  (path) => {
    expect(limitGroupOf(path)).toBeNull()
  },
)
