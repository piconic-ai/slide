// The monthly cost formula of docs/dev/scale-cost.md (D-140), as a pure
// function: the inputs and the unit prices are arguments, and nothing reads
// the clock or the network. The prices come from prices.mjs, the per-use
// counts from per-use.mjs.
import { OBSERVABILITY_PRICING_FROM, PRICES } from './prices.mjs'

/**
 * What one use takes. `workerRequests` are the requests a client makes;
 * `internalRequests` are the Worker's calls to its own cached entrypoints,
 * which Cloudflare bills like requests while the entrypoint's cache is on.
 *
 * @typedef {{
 *   workerRequests: number,
 *   internalRequests: number,
 *   cpuMs: number,
 *   d1RowsRead: number,
 *   d1RowsWritten: number,
 *   r2ClassA: number,
 *   r2ClassB: number,
 * }} PerUse
 *
 * @typedef {{
 *   views: number,
 *   slides: number,
 *   uploads: number,
 *   listViews: number,
 *   emails: number,
 *   coversPerView: number,
 *   revisitShare: number,
 *   cacheHitRate: number,
 *   versionsPerSlide: number,
 *   bytesPerVersion: number,
 *   d1BytesPerSlide: number,
 *   backup: boolean,
 *   logEventsPerRequest: number,
 *   logBytesPerEvent: number,
 *   analyticsPointsPerView: number,
 *   analyticsPointsPerUpload: number,
 *   asOf: string,
 *   view: PerUse,
 *   revisit: PerUse,
 *   upload: PerUse,
 *   list: PerUse,
 *   cover: PerUse,
 * }} Inputs
 */

const COUNTS = [
  'workerRequests',
  'internalRequests',
  'cpuMs',
  'd1RowsRead',
  'd1RowsWritten',
  'r2ClassA',
  'r2ClassB',
]
const NUMBERS = [
  'views',
  'slides',
  'uploads',
  'listViews',
  'emails',
  'coversPerView',
  'revisitShare',
  'cacheHitRate',
  'versionsPerSlide',
  'bytesPerVersion',
  'd1BytesPerSlide',
  'logEventsPerRequest',
  'logBytesPerEvent',
  'analyticsPointsPerView',
  'analyticsPointsPerUpload',
]
const USES = ['view', 'revisit', 'upload', 'list', 'cover']
const SHARES = ['revisitShare', 'cacheHitRate']

const isCount = (value) => Number.isFinite(value) && value >= 0

/** Throws when an input is missing, not a finite number, or negative. */
export function checkInputs(inputs) {
  for (const name of NUMBERS)
    if (!isCount(inputs[name]))
      throw new Error(`Input ${name} must be a number of 0 or more`)
  for (const name of SHARES)
    if (inputs[name] > 1)
      throw new Error(`Input ${name} is a share from 0 to 1`)
  if (typeof inputs.backup !== 'boolean')
    throw new Error('Input backup must be true or false')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inputs.asOf ?? ''))
    throw new Error('Input asOf must be a day as YYYY-MM-DD')
  for (const use of USES)
    for (const name of COUNTS)
      if (!isCount(inputs[use]?.[name]))
        throw new Error(`Input ${use}.${name} must be a number of 0 or more`)
}

const over = (quantity, included) => Math.max(0, quantity - included)

/** The cost of a quantity above its included amount, at a price per million. */
const perMillion = (quantity, included, price) =>
  (over(quantity, included) / 1_000_000) * price

/** @param {string} key @param {string} label @param {number} quantity @param {number} included @param {number} usd @param {string} unit */
const item = (key, label, quantity, included, usd, unit) => ({
  key,
  label,
  quantity,
  included,
  exceeds: quantity > included,
  usd,
  unit,
})

/** The sum of a count over the uses, each used `times` times. */
const total = (name, uses) =>
  uses.reduce((sum, [times, use]) => sum + times * use[name], 0)

/**
 * The monthly cost of the inputs at the prices, item by item.
 *
 * Views are a mix of first visits (`view`) and revisits (`revisit`, where the
 * browser holds the files and is told nothing changed). Files a first visit
 * reads through the internal cache read R2 only when it misses, so the R2 reads
 * of a view are scaled by one less the hit rate.
 *
 * @param {Inputs} inputs
 * @param {typeof PRICES} [prices]
 */
export function estimate(inputs, prices = PRICES) {
  checkInputs(inputs)
  const p = (name) => prices[name].value
  const { views, listViews, uploads, revisitShare, cacheHitRate } = inputs
  const first = views * (1 - revisitShare)
  const again = views * revisitShare
  const covers = views * inputs.coversPerView
  const uses = [
    [first, inputs.view],
    [again, inputs.revisit],
    [uploads, inputs.upload],
    [listViews, inputs.list],
    [covers, inputs.cover],
  ]
  const requests =
    total('workerRequests', uses) + total('internalRequests', uses)
  const cpuMs = total('cpuMs', uses)
  const rowsRead = total('d1RowsRead', uses)
  const rowsWritten = total('d1RowsWritten', uses)
  // A first visit reads the stored files, and does so on R2 only when the
  // internal cache misses. A cover is answered from the cache or the browser,
  // never from R2.
  const missed = 1 - cacheHitRate
  const copies = inputs.backup ? 1 : 0
  const classA =
    total('r2ClassA', uses) + inputs.upload.r2ClassA * uploads * copies
  const classB =
    (first * inputs.view.r2ClassB + again * inputs.revisit.r2ClassB) * missed +
    uploads * inputs.upload.r2ClassB +
    listViews * inputs.list.r2ClassB +
    covers * inputs.cover.r2ClassB +
    inputs.upload.r2ClassA * uploads * copies
  const storedBytes =
    inputs.slides *
    inputs.versionsPerSlide *
    inputs.bytesPerVersion *
    (1 + copies)
  const storageGb = storedBytes / 1e9
  const d1Gb = (inputs.slides * inputs.d1BytesPerSlide) / 1e9
  const logEvents = requests * inputs.logEventsPerRequest
  const points =
    views * inputs.analyticsPointsPerView +
    uploads * inputs.analyticsPointsPerUpload

  const logsAsEvents = inputs.asOf < OBSERVABILITY_PRICING_FROM
  const logItem = logsAsEvents
    ? item(
        'logs',
        'Workers Logs',
        logEvents,
        p('logsEventsIncluded'),
        perMillion(
          logEvents,
          p('logsEventsIncluded'),
          p('logsEventsPerMillion'),
        ),
        'events',
      )
    : item(
        'logs',
        'Observability ingestion',
        (logEvents * inputs.logBytesPerEvent) / 1e9,
        p('observabilityIngestIncludedGb'),
        over(
          (logEvents * inputs.logBytesPerEvent) / 1e9,
          p('observabilityIngestIncludedGb'),
        ) * p('observabilityIngestPerGb'),
        'GB',
      )

  const items = [
    item(
      'workersBase',
      'Workers Paid minimum',
      1,
      1,
      p('workersMonthly'),
      'account-months',
    ),
    item(
      'workersRequests',
      'Workers requests',
      requests,
      p('workersRequestsIncluded'),
      perMillion(
        requests,
        p('workersRequestsIncluded'),
        p('workersRequestsPerMillion'),
      ),
      'requests',
    ),
    item(
      'workersCpu',
      'Workers CPU time',
      cpuMs,
      p('workersCpuIncluded'),
      perMillion(cpuMs, p('workersCpuIncluded'), p('workersCpuPerMillionMs')),
      'CPU ms',
    ),
    item(
      'r2Storage',
      'R2 storage',
      storageGb,
      p('r2StorageIncludedGb'),
      over(storageGb, p('r2StorageIncludedGb')) * p('r2StoragePerGb'),
      'GB-month',
    ),
    item(
      'r2ClassA',
      'R2 Class A operations',
      classA,
      p('r2ClassAIncluded'),
      perMillion(classA, p('r2ClassAIncluded'), p('r2ClassAPerMillion')),
      'operations',
    ),
    item(
      'r2ClassB',
      'R2 Class B operations',
      classB,
      p('r2ClassBIncluded'),
      perMillion(classB, p('r2ClassBIncluded'), p('r2ClassBPerMillion')),
      'operations',
    ),
    item('r2Egress', 'R2 egress', 0, 0, 0 * p('r2EgressPerGb'), 'GB'),
    item(
      'd1RowsRead',
      'D1 rows read',
      rowsRead,
      p('d1RowsReadIncluded'),
      perMillion(rowsRead, p('d1RowsReadIncluded'), p('d1RowsReadPerMillion')),
      'rows',
    ),
    item(
      'd1RowsWritten',
      'D1 rows written',
      rowsWritten,
      p('d1RowsWrittenIncluded'),
      perMillion(
        rowsWritten,
        p('d1RowsWrittenIncluded'),
        p('d1RowsWrittenPerMillion'),
      ),
      'rows',
    ),
    item(
      'd1Storage',
      'D1 storage',
      d1Gb,
      p('d1StorageIncludedGb'),
      over(d1Gb, p('d1StorageIncludedGb')) * p('d1StoragePerGb'),
      'GB',
    ),
    logItem,
    item(
      'analytics',
      'Analytics Engine data points',
      points,
      p('analyticsPointsIncluded'),
      perMillion(
        points,
        p('analyticsPointsIncluded'),
        p('analyticsPointsPerMillion'),
      ),
      'data points',
    ),
    item(
      'email',
      'Email sending',
      inputs.emails,
      p('emailIncluded'),
      (over(inputs.emails, p('emailIncluded')) / 1000) * p('emailPerThousand'),
      'emails',
    ),
  ]
  return {
    items,
    usd: items.reduce((sum, row) => sum + row.usd, 0),
    exceeding: items.filter((row) => row.exceeds).map((row) => row.key),
  }
}
