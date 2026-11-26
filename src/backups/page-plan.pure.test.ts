import { expect, test } from 'vitest'
import { planPage, type SourceObject, type TrackedObject } from './page-plan'

const object = (key: string, etag = `e-${key}`): SourceObject => ({
  key,
  etag,
  size: 1,
})
const tracked = (
  key: string,
  etag = `e-${key}`,
  goneAt: number | null = null,
): TrackedObject => ({ key, etag, goneAt })

test('F39-AC25: Given objects the backup does not know, When a page is planned, Then each is copied', () => {
  const plan = planPage([object('a'), object('b')], [])
  expect(plan.copy.map(({ key }) => key)).toEqual(['a', 'b'])
  expect(plan.revive).toEqual([])
  expect(plan.gone).toEqual([])
})

test('F39-AC26: Given objects the backup knows by the same etag, When a page is planned, Then none is copied again', () => {
  const plan = planPage(
    [object('a'), object('b')],
    [tracked('a'), tracked('b')],
  )
  expect(plan).toEqual({ copy: [], revive: [], gone: [] })
})

test('F39-AC25: Given a key put again with other content, When a page is planned, Then it is copied again', () => {
  const plan = planPage([object('a', 'new')], [tracked('a', 'old')])
  expect(plan.copy).toEqual([object('a', 'new')])
})

test('F39-AC27: Given a copy the page does not list, When a page is planned, Then it is gone', () => {
  const plan = planPage([object('a')], [tracked('a'), tracked('b')])
  expect(plan.gone).toEqual(['b'])
  expect(plan.copy).toEqual([])
})

test('F39-AC27: Given a copy already known to be gone, When a page does not list it, Then it is not gone again, so its 30 days do not restart', () => {
  const plan = planPage([], [tracked('b', 'e-b', 100)])
  expect(plan.gone).toEqual([])
})

test('F39-AC27: Given a copy whose source is listed again with the same content, When a page is planned, Then it is revived and not copied', () => {
  const plan = planPage([object('b')], [tracked('b', 'e-b', 100)])
  expect(plan).toEqual({ copy: [], revive: ['b'], gone: [] })
})

test('F39-AC27: Given a gone copy whose source came back with other content, When a page is planned, Then it is copied', () => {
  const plan = planPage([object('b', 'new')], [tracked('b', 'old', 100)])
  expect(plan.copy).toEqual([object('b', 'new')])
  expect(plan.revive).toEqual([])
})

test('F39-AC25: Given an empty page and an empty backup, When a page is planned, Then nothing is asked', () => {
  expect(planPage([], [])).toEqual({ copy: [], revive: [], gone: [] })
})

test('F39-AC27: Given an empty last page and copies after the cursor, When a page is planned, Then every one of them is gone', () => {
  const plan = planPage([], [tracked('x'), tracked('y')])
  expect(plan.gone).toEqual(['x', 'y'])
})
