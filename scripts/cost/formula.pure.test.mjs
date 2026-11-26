import { describe, expect, it } from 'vitest'
import { checkInputs, estimate } from './formula.mjs'
import { PRICES, PRICE_NAMES } from './prices.mjs'

const none = {
  workerRequests: 0,
  internalRequests: 0,
  cpuMs: 0,
  d1RowsRead: 0,
  d1RowsWritten: 0,
  r2ClassA: 0,
  r2ClassB: 0,
}

/** Inputs that use nothing, so a test names only what it spends. */
const idle = () => ({
  views: 0,
  slides: 0,
  uploads: 0,
  listViews: 0,
  emails: 0,
  coversPerView: 0,
  revisitShare: 0,
  cacheHitRate: 0,
  versionsPerSlide: 1,
  bytesPerVersion: 0,
  d1BytesPerSlide: 0,
  backup: false,
  logEventsPerRequest: 0,
  logBytesPerEvent: 0,
  analyticsPointsPerView: 0,
  analyticsPointsPerUpload: 0,
  asOf: '2026-11-26',
  view: { ...none },
  revisit: { ...none },
  upload: { ...none },
  list: { ...none },
  cover: { ...none },
})

const row = (result, key) => result.items.find((item) => item.key === key)

describe('the cost formula', () => {
  it('COST-AC1: Given 20 million views of one request each, When estimated, Then 10 million requests beyond the included cost $3 on top of the $5 minimum', () => {
    // 20,000,000 - 10,000,000 included = 10 million over, at $0.30 each million.
    const inputs = {
      ...idle(),
      views: 20_000_000,
      view: { ...none, workerRequests: 1 },
    }
    const result = estimate(inputs)
    expect(row(result, 'workersRequests').quantity).toBe(20_000_000)
    expect(row(result, 'workersRequests').usd).toBeCloseTo(3, 10)
    expect(result.usd).toBeCloseTo(8, 10)
    expect(result.exceeding).toEqual(['workersRequests'])
  })

  it('COST-AC1: Given reads, writes, uploads and mail, When estimated, Then each item is the hand-calculated sum', () => {
    // 1,000,000 views, 40 R2 reads each = 40,000,000, half answered by the
    // internal cache = 20,000,000 reads; 10,000,000 free, 10 million over at
    // $0.36 = $3.60. 500,000 uploads of 20 puts = 10,000,000 Class A;
    // 1,000,000 free, 9 million over at $4.50 = $40.50. D1 writes: 500,000
    // uploads of 300 rows = 150,000,000; 50,000,000 free, 100 million over at
    // $1 = $100. 13,000 emails: 10,000 over at $0.35 per thousand = $3.50.
    const inputs = {
      ...idle(),
      views: 1_000_000,
      uploads: 500_000,
      emails: 13_000,
      cacheHitRate: 0.5,
      view: { ...none, r2ClassB: 40 },
      upload: { ...none, r2ClassA: 20, d1RowsWritten: 300 },
    }
    const result = estimate(inputs)
    expect(row(result, 'r2ClassB').quantity).toBeCloseTo(20_000_000, 3)
    expect(row(result, 'r2ClassB').usd).toBeCloseTo(3.6, 10)
    expect(row(result, 'r2ClassA').usd).toBeCloseTo(40.5, 10)
    expect(row(result, 'd1RowsWritten').usd).toBeCloseTo(100, 10)
    expect(row(result, 'email').usd).toBeCloseTo(3.5, 10)
    expect(result.usd).toBeCloseTo(5 + 3.6 + 40.5 + 100 + 3.5, 10)
  })

  it('COST-AC1: Given storage with a backup copy and a mix of first visits and revisits, When estimated, Then the copy doubles storage and revisits read no file', () => {
    // 4,000 slides of 5,000,000,000 bytes kept once = 20,000 GB, doubled by
    // the copy = 40,000 GB; 10 free; 39,990 over at $0.015 = $599.85.
    // 200 views, a quarter of them revisits: 150 first visits read 10 files
    // each and 50 revisits read none, so 1,500 reads.
    const inputs = {
      ...idle(),
      slides: 4_000,
      bytesPerVersion: 5_000_000_000,
      backup: true,
      views: 200,
      revisitShare: 0.25,
      view: { ...none, r2ClassB: 10 },
    }
    const result = estimate(inputs)
    expect(row(result, 'r2Storage').quantity).toBeCloseTo(40_000, 6)
    expect(row(result, 'r2Storage').usd).toBeCloseTo(599.85, 6)
    expect(row(result, 'r2ClassB').quantity).toBeCloseTo(1_500, 6)
  })

  it('COST-AC2: Given use inside every free allowance, When estimated, Then every item costs 0 except the $5 minimum and nothing is said to exceed', () => {
    const inputs = {
      ...idle(),
      views: 1_000,
      slides: 100,
      uploads: 10,
      listViews: 500,
      emails: 3_000,
      bytesPerVersion: 1_000_000,
      d1BytesPerSlide: 5_000,
      logEventsPerRequest: 1,
      logBytesPerEvent: 1_000,
      analyticsPointsPerView: 1,
      view: {
        workerRequests: 60,
        internalRequests: 30,
        cpuMs: 20,
        d1RowsRead: 40,
        d1RowsWritten: 0,
        r2ClassA: 0,
        r2ClassB: 30,
      },
      upload: { ...none, workerRequests: 32, r2ClassA: 30, d1RowsWritten: 100 },
      list: { ...none, workerRequests: 3, d1RowsRead: 1_000 },
    }
    for (const asOf of ['2026-11-26', '2026-12-01']) {
      const result = estimate({ ...inputs, asOf })
      for (const item of result.items)
        expect(item.usd, item.key).toBe(item.key === 'workersBase' ? 5 : 0)
      expect(result.exceeding).toEqual([])
    }
  })

  it('COST-AC2: Given a quantity exactly at its included amount, When estimated, Then it costs 0; one more costs the unit price', () => {
    const at = {
      ...idle(),
      emails: 3_000,
    }
    expect(row(estimate(at), 'email').usd).toBe(0)
    expect(row(estimate({ ...at, emails: 4_000 }), 'email').usd).toBeCloseTo(
      0.35,
      10,
    )
    expect(row(estimate({ ...at, emails: 3_001 }), 'email').exceeds).toBe(true)
  })

  it('COST-AC1: Given a day before and a day after 2026-12-01, When logs exceed the allowance, Then the first day is billed per event and the second per gigabyte', () => {
    // 40 million requests of 1 event: 20 million over at $0.60 = $12 before.
    // The same events of 2,000 bytes = 80 GB; 50 free, 30 over at $0.25 =
    // $7.50 after.
    const inputs = {
      ...idle(),
      views: 40_000_000,
      view: { ...none, workerRequests: 1 },
      logEventsPerRequest: 1,
      logBytesPerEvent: 2_000,
    }
    expect(
      row(estimate({ ...inputs, asOf: '2026-11-30' }), 'logs').usd,
    ).toBeCloseTo(12, 10)
    const after = row(estimate({ ...inputs, asOf: '2026-12-01' }), 'logs')
    expect(after.unit).toBe('GB')
    expect(after.usd).toBeCloseTo(7.5, 10)
  })

  it('COST-AC1: Given the internal calls, When they are counted, Then they are billed like requests', () => {
    const inputs = {
      ...idle(),
      views: 10_000_000,
      view: { ...none, workerRequests: 1, internalRequests: 1 },
    }
    expect(row(estimate(inputs), 'workersRequests').quantity).toBe(20_000_000)
  })

  it.each([
    ['a negative count', { views: -1 }],
    ['not a number', { views: Number.NaN }],
    ['infinite', { slides: Number.POSITIVE_INFINITY }],
    ['a share above 1', { cacheHitRate: 1.5 }],
    ['a missing field', { emails: undefined }],
    ['a backup that is not a boolean', { backup: 'yes' }],
    ['a day that is not a day', { asOf: 'today' }],
    ['a use with a negative count', { view: { ...none, r2ClassB: -2 } }],
    ['a use missing', { cover: undefined }],
  ])(
    'COST-AC1: Given %s, When the inputs are checked, Then they are refused',
    (_name, change) => {
      expect(() => checkInputs({ ...idle(), ...change })).toThrow()
      expect(() => estimate({ ...idle(), ...change })).toThrow()
    },
  )
})

describe('the price table', () => {
  it.each(PRICE_NAMES)(
    'COST-AC3: Given the price %s, When it is read, Then it names an official page and the day it was checked',
    (name) => {
      const price = PRICES[name]
      expect(price.source).toMatch(
        /^https:\/\/developers\.cloudflare\.com\/\S+$/,
      )
      expect(price.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(Date.parse(price.checkedOn))).toBe(false)
      expect(price.unit.length).toBeGreaterThan(0)
      expect(Number.isFinite(price.value) && price.value >= 0).toBe(true)
    },
  )
})
