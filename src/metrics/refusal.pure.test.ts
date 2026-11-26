import { expect, test } from 'vitest'
import { refusalClassOf } from './refusal'

test.each([
  'too_many_files',
  'file_too_large',
  'deployment_too_large',
  'author_bytes_exceeded',
  'daily_starts_exceeded',
])(
  'F40-AC6: Given a start refused for %s, When it is read, Then it is counted under that reason',
  (reason) => {
    expect(
      refusalClassOf({ code: 'start_rejected', details: { reason } }),
    ).toBe(reason)
  },
)

test('F40-AC6: Given a start refused because the author holds as many slides as allowed, When it is read, Then it is counted as deck_limit', () => {
  expect(refusalClassOf({ code: 'deck_limit', details: {} })).toBe('deck_limit')
})

test.each([
  null,
  undefined,
  'start_rejected',
  42,
  {},
  { code: 'upload_busy' },
  { code: 'inventory_conflict', details: { reason: 'too_many_files' } },
  { code: 'start_rejected' },
  { code: 'start_rejected', details: null },
  { code: 'start_rejected', details: { reason: 'something_new' } },
  { code: 'start_rejected', details: { reason: 7 } },
  { code: 'start_rejected', details: { reason: 'a@b.example' } },
])(
  'F40-AC6: Given the thrown value %j, When it is read, Then it is no countable refusal',
  (thrown) => {
    expect(refusalClassOf(thrown)).toBeNull()
  },
)
