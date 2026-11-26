import { describe, expect, test } from 'vitest'
import { OFFLINE_MAX_AGE_MS, OFFLINE_MAX_VERSIONS } from './limits'
import {
  evictedOrigin,
  evictKey,
  planPrune,
  recordPath,
  type ViewerRecord,
} from './records'

const NOW = 1_700_000_000_000
const MGMT = 'https://slide.example'
const record = (n: number, age: number): ViewerRecord => ({
  key: `${MGMT}/@a/deck-${String(n).padStart(3, '0')}`,
  storedAt: NOW - age,
  origin: `https://d-${n}.content.example`,
})

describe('planPrune', () => {
  test('F37-AC11: Given 21 versions opened a minute apart, When the viewer prunes, Then the one opened longest ago is evicted and 20 stay', () => {
    const records = Array.from({ length: OFFLINE_MAX_VERSIONS + 1 }, (_, n) =>
      record(n, (n + 1) * 60_000),
    )
    const { keep, evict } = planPrune(records, NOW)
    expect(keep).toHaveLength(OFFLINE_MAX_VERSIONS)
    expect(evict).toEqual([records[OFFLINE_MAX_VERSIONS]])
    expect(keep.map((r) => r.key)).not.toContain(
      records[OFFLINE_MAX_VERSIONS]!.key,
    )
  })

  test('Given exactly 20 versions, Then none is evicted', () => {
    const records = Array.from({ length: OFFLINE_MAX_VERSIONS }, (_, n) =>
      record(n, n * 1000),
    )
    expect(planPrune(records, NOW).evict).toEqual([])
  })

  test('F37-AC10: Given a version past a day, Then it is evicted even when there are few; one exactly a day old stays', () => {
    const old = record(1, OFFLINE_MAX_AGE_MS + 1)
    const edge = record(2, OFFLINE_MAX_AGE_MS)
    const { keep, evict } = planPrune([old, edge], NOW)
    expect(evict).toEqual([old])
    expect(keep).toEqual([edge])
  })

  test('Given stale ones and more than 20 fresh ones, Then every stale one and the oldest fresh ones are evicted', () => {
    const fresh = Array.from({ length: 22 }, (_, n) => record(n, n * 1000))
    const stale = [record(100, OFFLINE_MAX_AGE_MS * 3)]
    const { keep, evict } = planPrune([...stale, ...fresh], NOW)
    expect(keep).toHaveLength(20)
    expect(evict).toEqual([...stale, fresh[20], fresh[21]])
  })

  test.each([[Number.NaN], [NOW + 1000], [Number.POSITIVE_INFINITY]])(
    'Given a time that nobody fetched at (%s), Then the record is evicted',
    (storedAt) => {
      const odd = { ...record(1, 0), storedAt }
      expect(planPrune([odd], NOW).evict).toEqual([odd])
    },
  )

  test('Given none, Then there is nothing to do', () => {
    expect(planPrune([], NOW)).toEqual({ keep: [], evict: [] })
  })

  test('Given records opened at the same moment, Then the result does not depend on the order they are read in', () => {
    const same = Array.from({ length: 22 }, (_, n) => record(n, 5000))
    const a = planPrune(same, NOW)
    const b = planPrune([...same].reverse(), NOW)
    expect(b.evict.map((r) => r.key).sort()).toEqual(
      a.evict.map((r) => r.key).sort(),
    )
  })
})

describe('recordPath', () => {
  test.each([
    ['/@alice/good-slide', '/@alice/good-slide'],
    ['/@alice/good-slide/6', '/@alice/good-slide'],
    ['/@alice', null],
    ['/@alice/following', null],
    ['/@Alice/Good-Slide', null],
    ['/@alice/good-slide/', null],
    ['/@alice/good-slide/0', null],
    ['/help', null],
    ['/', null],
    ['', null],
  ])('Given %s, Then the record is %s', (path, expected) => {
    expect(recordPath(path)).toBe(expected)
  })
})

describe('the list of versions to clear', () => {
  test('Given a version origin, Then the key names it back', () => {
    const origin = 'https://d-1.content.example:8787'
    expect(evictedOrigin(MGMT, evictKey(MGMT, origin))).toBe(origin)
  })

  test.each([
    `${MGMT}/@a/b`,
    `${MGMT}/_offline/evict/%E0%A4%A`,
    'https://other.example/_offline/evict/x',
  ])('Given the key %s, Then it names no origin', (key) => {
    expect(evictedOrigin(MGMT, key)).toBeNull()
  })
})
