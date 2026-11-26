// The unit prices and free allowances the cost formula uses, in one place
// (D-140). Every row names the official page it was read from and the day it
// was checked; docs/dev/scale-cost.md shows the same rows as a table, and
// scripts/cost/prices.pure.test.mjs fails when a row lacks either.
//
// Prices change. Re-read each page, then change the value and `checkedOn`
// together. Amounts are US dollars; an `included` amount is per month.

const CHECKED = '2026-11-26'
const WORKERS = 'https://developers.cloudflare.com/workers/platform/pricing/'
const R2 = 'https://developers.cloudflare.com/r2/pricing/'
const D1 = 'https://developers.cloudflare.com/d1/platform/pricing/'

/**
 * @typedef {{
 *   value: number,
 *   unit: string,
 *   source: string,
 *   checkedOn: string,
 *   note?: string,
 * }} Price
 */

/** @type {Record<string, Price>} */
export const PRICES = {
  workersMonthly: {
    value: 5,
    unit: 'USD per month, the Workers Paid minimum for the account',
    source: WORKERS,
    checkedOn: CHECKED,
  },
  workersRequestsIncluded: {
    value: 10_000_000,
    unit: 'requests per month included in Workers Paid',
    source: WORKERS,
    checkedOn: CHECKED,
  },
  workersRequestsPerMillion: {
    value: 0.3,
    unit: 'USD per million requests beyond the included',
    source: WORKERS,
    checkedOn: CHECKED,
  },
  workersCpuIncluded: {
    value: 30_000_000,
    unit: 'CPU milliseconds per month included in Workers Paid',
    source: WORKERS,
    checkedOn: CHECKED,
  },
  workersCpuPerMillionMs: {
    value: 0.02,
    unit: 'USD per million CPU milliseconds beyond the included',
    source: WORKERS,
    checkedOn: CHECKED,
    note: 'Duration is not billed.',
  },
  r2StorageIncludedGb: {
    value: 10,
    unit: 'GB-month of Standard storage free each month',
    source: R2,
    checkedOn: CHECKED,
  },
  r2StoragePerGb: {
    value: 0.015,
    unit: 'USD per GB-month of Standard storage',
    source: R2,
    checkedOn: CHECKED,
  },
  r2ClassAIncluded: {
    value: 1_000_000,
    unit: 'Class A operations free each month',
    source: R2,
    checkedOn: CHECKED,
    note: 'PutObject, CopyObject, ListObjects and multipart calls. DeleteObject is free.',
  },
  r2ClassAPerMillion: {
    value: 4.5,
    unit: 'USD per million Class A operations',
    source: R2,
    checkedOn: CHECKED,
  },
  r2ClassBIncluded: {
    value: 10_000_000,
    unit: 'Class B operations free each month',
    source: R2,
    checkedOn: CHECKED,
    note: 'GetObject and HeadObject.',
  },
  r2ClassBPerMillion: {
    value: 0.36,
    unit: 'USD per million Class B operations',
    source: R2,
    checkedOn: CHECKED,
  },
  r2EgressPerGb: {
    value: 0,
    unit: 'USD per GB sent out of R2 to the internet',
    source: R2,
    checkedOn: CHECKED,
    note: 'The page says there is no charge for egress on any storage class.',
  },
  d1RowsReadIncluded: {
    value: 25_000_000_000,
    unit: 'rows read per month included in Workers Paid',
    source: D1,
    checkedOn: CHECKED,
  },
  d1RowsReadPerMillion: {
    value: 0.001,
    unit: 'USD per million rows read beyond the included',
    source: D1,
    checkedOn: CHECKED,
  },
  d1RowsWrittenIncluded: {
    value: 50_000_000,
    unit: 'rows written per month included in Workers Paid',
    source: D1,
    checkedOn: CHECKED,
  },
  d1RowsWrittenPerMillion: {
    value: 1,
    unit: 'USD per million rows written beyond the included',
    source: D1,
    checkedOn: CHECKED,
    note: 'A write to an indexed column also writes one row for each index.',
  },
  d1StorageIncludedGb: {
    value: 5,
    unit: 'GB of D1 storage included in Workers Paid',
    source: D1,
    checkedOn: CHECKED,
  },
  d1StoragePerGb: {
    value: 0.75,
    unit: 'USD per GB-month of D1 storage beyond the included',
    source: D1,
    checkedOn: CHECKED,
  },
  // Workers Logs are billed per event until 2026-11-30 and, from 2026-12-01,
  // by the gigabyte under Cloudflare Observability pricing. The formula uses
  // the pricing in force on the day the estimate is read; see logPricing.
  logsEventsIncluded: {
    value: 20_000_000,
    unit: 'Workers Logs events per month included in Workers Paid (until 2026-11-30)',
    source:
      'https://developers.cloudflare.com/workers/observability/logs/workers-logs/',
    checkedOn: CHECKED,
  },
  logsEventsPerMillion: {
    value: 0.6,
    unit: 'USD per million Workers Logs events beyond the included (until 2026-11-30)',
    source:
      'https://developers.cloudflare.com/workers/observability/logs/workers-logs/',
    checkedOn: CHECKED,
  },
  observabilityIngestIncludedGb: {
    value: 50,
    unit: 'GB of Observability ingestion included per billing cycle on Paid (from 2026-12-01)',
    source: 'https://developers.cloudflare.com/observability/pricing/',
    checkedOn: CHECKED,
  },
  observabilityIngestPerGb: {
    value: 0.25,
    unit: 'USD per GB of Observability ingestion beyond the included (from 2026-12-01)',
    source: 'https://developers.cloudflare.com/observability/pricing/',
    checkedOn: CHECKED,
  },
  analyticsPointsIncluded: {
    value: 10_000_000,
    unit: 'Analytics Engine data points written per month included in Workers Paid',
    source:
      'https://developers.cloudflare.com/analytics/analytics-engine/pricing/',
    checkedOn: CHECKED,
    note: 'The page says billing has not started; the price is published in advance.',
  },
  analyticsPointsPerMillion: {
    value: 0.25,
    unit: 'USD per million data points written beyond the included',
    source:
      'https://developers.cloudflare.com/analytics/analytics-engine/pricing/',
    checkedOn: CHECKED,
    note: 'The page says billing has not started; the price is published in advance.',
  },
  emailIncluded: {
    value: 3_000,
    unit: 'emails sent per month included in Workers Paid',
    source: 'https://developers.cloudflare.com/email-service/platform/pricing/',
    checkedOn: CHECKED,
  },
  emailPerThousand: {
    value: 0.35,
    unit: 'USD per 1,000 emails beyond the included',
    source: 'https://developers.cloudflare.com/email-service/platform/pricing/',
    checkedOn: CHECKED,
  },
}

/** The first day Workers Logs are billed as Cloudflare Observability. */
export const OBSERVABILITY_PRICING_FROM = '2026-12-01'

/** The name of every price, for a caller that checks for a missing one. */
export const PRICE_NAMES = Object.keys(PRICES)
