import { expect, test } from 'vitest'
import { app } from '../app/routes'
import { checkHandle, RESERVED_HANDLES } from './handle-rules'

test.each(['a', 'kfly8', 'a-b', '0', 'a'.repeat(39), 'x-'])(
  'F28-AC18: Given %j, When it is checked, Then it is a handle',
  (handle) => {
    expect(checkHandle(handle)).toEqual({ kind: 'valid', handle })
  },
)

test.each([
  ['', 'empty'],
  ['a'.repeat(40), 'too_long'],
  ['Upper', 'invalid_characters'],
  ['a b', 'invalid_characters'],
  ['a_b', 'invalid_characters'],
  ['日本語', 'invalid_characters'],
  ['a.b', 'invalid_characters'],
  ['-a', 'leading_hyphen'],
  ['--', 'leading_hyphen'],
  ['login', 'reserved'],
  ['admin', 'reserved'],
])(
  'F28-AC18 F28-AC19: Given %j, When it is checked, Then it is refused as %s',
  (handle, reason) => {
    expect(checkHandle(handle)).toEqual({ kind: 'refused', reason })
  },
)

test('F28-AC19: Given every word the issue and the decisions name, When they are checked, Then each is reserved', () => {
  for (const word of [
    'login',
    'welcome',
    'settings',
    'slides',
    'help',
    'auth',
    'api',
    'mcp',
    'embed',
    'events',
    'notifications',
    'operator',
    'admin',
    'slide',
    'support',
    'me',
  ])
    expect(RESERVED_HANDLES.has(word), word).toBe(true)
})

test('F28-AC19: Given the routes the app answers, When their first segments are read, Then every fixed one is a reserved handle', () => {
  const first = new Set(
    app.routes
      .map(({ path }) => path.split('/')[1] ?? '')
      // `/@handle/...`, parameters, wildcards and files are not words a
      // handle can take.
      .filter(
        (segment) => /^[a-z0-9-]+$/.test(segment) && !segment.startsWith('-'),
      ),
  )
  expect(first.size).toBeGreaterThan(10)
  for (const segment of first)
    expect(RESERVED_HANDLES.has(segment), `/${segment}`).toBe(true)
})
