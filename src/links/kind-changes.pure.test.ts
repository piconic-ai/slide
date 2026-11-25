import { expect, test } from 'vitest'
import { kindChanges } from './kind-changes'

const links = [
  { id: 'a', url: 'https://example.com/a', kind: 'other' },
  { id: 'b', url: 'https://luma.com/x1', kind: 'event' },
] as const

test('F27-AC84: Given kinds chosen again for some links, When the form is read, Then only the changed ones are changes', () => {
  expect(kindChanges(links, { 'kind-a': 'event', 'kind-b': 'event' })).toEqual({
    ok: true,
    changes: [{ id: 'a', url: 'https://example.com/a', kind: 'event' }],
  })
})

test('F27-AC84: Given a form that leaves links out or names unknown ones, When it is read, Then those keep their kinds', () => {
  expect(kindChanges(links, { 'kind-zzz': 'video', other: 'x' })).toEqual({
    ok: true,
    changes: [],
  })
})

test.each(['podcast', '', ['video', 'article'], 1])(
  'F27-AC84: Given the kind %j, which is none of the four, When the form is read, Then it is refused',
  (chosen) => {
    expect(kindChanges(links, { 'kind-a': chosen })).toEqual({ ok: false })
  },
)
