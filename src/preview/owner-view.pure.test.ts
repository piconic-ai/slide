import { expect, test } from 'vitest'
import { chooseOwnerView } from './owner-view'

const old = { id: 'old', readyAt: 1 }
const fresh = { id: 'new', readyAt: 5 }

test('F02-AC43: Given a public version, When the address names no version, Then readers’ version is shown', () => {
  expect(
    chooseOwnerView(
      { kind: 'public', deploymentId: 'old' },
      [old, fresh],
      null,
    ),
  ).toEqual({ kind: 'readers' })
})

test('F02-AC41: Given a public version and a newer one, When the address names the newer, Then it is shown as newer', () => {
  expect(
    chooseOwnerView(
      { kind: 'public', deploymentId: 'old' },
      [old, fresh],
      'new',
    ),
  ).toEqual({ kind: 'newer', deploymentId: 'new' })
})

test('F02-AC30: Given a public version, When the address names the public or an unknown version, Then readers’ version is shown', () => {
  const publication = { kind: 'public', deploymentId: 'old' } as const
  expect(chooseOwnerView(publication, [old, fresh], 'old')).toEqual({
    kind: 'readers',
  })
  expect(chooseOwnerView(publication, [old, fresh], 'other')).toEqual({
    kind: 'readers',
  })
})

test('F02-AC44: Given no public version, When the address names none, Then the newest received version is shown', () => {
  expect(chooseOwnerView({ kind: 'draft' }, [old, fresh], null)).toEqual({
    kind: 'draft',
    deploymentId: 'new',
  })
  expect(
    chooseOwnerView({ kind: 'paused', resumeTo: 'old' }, [fresh, old], null),
  ).toEqual({ kind: 'paused', deploymentId: 'new' })
})

test('F02-AC42: Given no public version, When the address names a received version, Then that version is shown', () => {
  expect(chooseOwnerView({ kind: 'draft' }, [old, fresh], 'old')).toEqual({
    kind: 'draft',
    deploymentId: 'old',
  })
})

test('F02-AC18: Given nothing received, When the owner opens the viewer, Then there is nothing to show', () => {
  expect(chooseOwnerView({ kind: 'draft' }, [], null)).toBeNull()
  expect(chooseOwnerView({ kind: 'draft' }, [], 'x')).toBeNull()
})
