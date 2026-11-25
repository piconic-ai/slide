import { describe, expect, test } from 'vitest'
import { planSweep } from './sweep-plan'

const objects = [
  { key: 'd/0/kept', uploaded: 100 },
  { key: 'd/0/late', uploaded: 100 },
  { key: 'd/1/young', uploaded: 950 },
]
const referenced = new Set(['d/0/kept'])

describe('sweep plan', () => {
  test('keeps referenced objects of a ready deployment', () => {
    expect(
      planSweep(
        { id: 'd', state: 'ready' },
        objects.slice(0, 2),
        referenced,
        1000,
        60,
      ),
    ).toEqual({ delete: ['d/0/late'], complete: true })
  })

  test.each(['failed', 'expired'] as const)(
    'removes every old object of a %s deployment',
    (state) => {
      expect(
        planSweep(
          { id: 'd', state },
          objects.slice(0, 2),
          referenced,
          1000,
          60,
        ),
      ).toEqual({ delete: ['d/0/kept', 'd/0/late'], complete: true })
    },
  )

  test('keeps young objects and asks for another visit', () => {
    expect(
      planSweep({ id: 'd', state: 'ready' }, objects, referenced, 1000, 60),
    ).toEqual({ delete: ['d/0/late'], complete: false })
  })

  test('treats the grace boundary as old and an empty prefix as complete', () => {
    expect(
      planSweep(
        { id: 'd', state: 'expired' },
        [objects[2]],
        new Set(),
        1010,
        60,
      ),
    ).toEqual({ delete: ['d/1/young'], complete: true })
    expect(
      planSweep({ id: 'd', state: 'ready' }, [], new Set(), 1000, 60),
    ).toEqual({ delete: [], complete: true })
  })
})
