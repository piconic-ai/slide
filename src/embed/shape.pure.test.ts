import { expect, test } from 'vitest'
import { embedShapeOf, embedViaOf } from './shape'

test('F25-AC12: Given t=compact, When the shape is read, Then it is compact', () => {
  expect(embedShapeOf('compact')).toBe('compact')
})

test.each([
  undefined,
  null,
  '',
  'full',
  'Compact',
  'COMPACT',
  ' compact',
  'compact ',
  'compact,full',
  '0',
  'line',
])(
  'F25-AC12: Given t is %j, When the shape is read, Then it is the full shape with the line',
  (t) => {
    expect(embedShapeOf(t)).toBe('full')
  },
)

test('F40-AC26: Given a shape, When the source of a view is decided, Then only the compact shape is the timeline', () => {
  expect(embedViaOf('compact')).toBe('timeline')
  expect(embedViaOf('full')).toBe('embed')
})
