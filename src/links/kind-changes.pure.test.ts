import { expect, test } from 'vitest'
import { kindChanges } from './kind-changes'

const links = [
  { id: 'a', url: 'https://example.com/a', kind: 'other' },
  { id: 'b', url: 'https://luma.com/x1', kind: 'event' },
] as const

test('F27-AC88: Given kinds chosen again for some links, When the form is read, Then only the changed ones are changes', () => {
  expect(kindChanges(links, { 'kind-a': 'event', 'kind-b': 'event' })).toEqual({
    ok: true,
    changes: [{ id: 'a', url: 'https://example.com/a', kind: 'event' }],
  })
})

test('F27-AC88: Given a form that leaves links out or names unknown ones, When it is read, Then those keep their kinds', () => {
  expect(kindChanges(links, { 'kind-zzz': 'video', other: 'x' })).toEqual({
    ok: true,
    changes: [],
  })
})

test.each(['podcast', '', ['video', 'article'], 1])(
  'F27-AC88: Given the kind %j, which is none of the four, When the form is read, Then it is refused',
  (chosen) => {
    expect(kindChanges(links, { 'kind-a': chosen })).toEqual({ ok: false })
  },
)

test('F45-AC37: Given an address shaped like an event, When another kind is chosen for it, Then nothing changes; kept without its event, any choice makes it an event', () => {
  const kept = [
    { id: 'b', url: 'https://luma.com/x1', kind: 'event' },
    { id: 'c', url: 'https://connpass.com/event/7/?foo=1', kind: 'other' },
    { id: 'd', url: 'https://example.com/conf', kind: 'event' },
  ] as const
  expect(
    kindChanges(kept, {
      'kind-b': 'video',
      'kind-c': 'other',
      'kind-d': 'other',
    }),
  ).toEqual({
    ok: true,
    changes: [
      { id: 'c', url: 'https://connpass.com/event/7/?foo=1', kind: 'event' },
      { id: 'd', url: 'https://example.com/conf', kind: 'other' },
    ],
  })
})
