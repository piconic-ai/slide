import { describe, expect, test } from 'vitest'
import { parseInventoryStructure } from './inventory'
import { parseUploadLimits } from './limits'
import {
  inventoryRejection,
  quotaDecision,
  startRejectionResponse,
  startRejections,
} from './rejections'

const limits = parseUploadLimits({
  files: 2,
  fileBytes: 4,
  deploymentBytes: 6,
  authorBytes: 10,
  startsPerDay: 2,
  activeSessions: 1,
})
const hash = 'a'.repeat(64)
const inventory = (...sizes: number[]) =>
  parseInventoryStructure({
    entry: 'index.html',
    files: sizes.map((size, index) => ({
      path: index ? `${index}.js` : 'index.html',
      size,
      sha256: hash,
    })),
  })
const usage = (
  storedBytes = 0,
  activeSessions = 0,
  startsInWindow = 0,
  reservedBytes = 0,
) => ({ storedBytes, reservedBytes, activeSessions, startsInWindow })

describe('inventory rejection', () => {
  test.each([
    [[4, 2], null],
    [[0], null],
    [[1, 1, 1], 'too_many_files'],
    [[5], 'file_too_large'],
    [[4, 3], 'deployment_too_large'],
  ])('maps sizes %j to %s', (sizes, expected) => {
    expect(inventoryRejection(inventory(...sizes), limits)).toBe(expected)
  })
})

describe('quota decision', () => {
  test.each([
    [usage(4), 6, { kind: 'race' }],
    [usage(5), 6, { kind: 'rejected', reason: 'author_bytes_exceeded' }],
    [usage(0, 0, 2), 1, { kind: 'rejected', reason: 'daily_starts_exceeded' }],
    [usage(0, 1), 1, { kind: 'busy' }],
    [usage(10, 1, 2), 1, { kind: 'rejected', reason: 'daily_starts_exceeded' }],
    // Bytes reserved by an open session may be released, so they only delay.
    [usage(0, 0, 0, 5), 6, { kind: 'busy' }],
    [usage(4, 0, 0, 1), 6, { kind: 'busy' }],
    [
      usage(5, 0, 0, 5),
      6,
      { kind: 'rejected', reason: 'author_bytes_exceeded' },
    ],
  ])('given %j and %i bytes, decides %j', (current, bytes, expected) => {
    expect(quotaDecision(current, bytes, limits)).toEqual(expected)
  })
})

describe('rejection response', () => {
  test('uses 413 for inventory limits and 409 for quotas', () => {
    expect(
      startRejections.map((reason) => startRejectionResponse(reason).status),
    ).toEqual([413, 413, 413, 409, 409])
  })
})
