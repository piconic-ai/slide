import { expect, test } from 'vitest'
import { app } from '../app/routes'
import { RESERVED_HANDLES, ROUTE_HANDLES } from './handle-rules'

test('F28-AC19: Given the routes the app answers, When their first segments are read, Then they are exactly the route words reserved as handles', () => {
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
  // `communities` is a third scope route, made by its later work (F30-AC3):
  // it comes off this list with its route.
  // `operator` lives on another host. Every other route word has a route.
  expect(
    ROUTE_HANDLES.filter((word) => !first.has(word)),
    'reserved route words with no route',
  ).toEqual(['communities', 'operator'])
})
