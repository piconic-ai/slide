import {
  PAGE_OPENING,
  PAGE_UNKNOWN,
  SEEN,
  type Kind,
  type Traffic,
} from './traffic'

/** Rows a table shows. More than these says that more were reported. */
export const ROWS_SHOWN = 50
/** Pages a row names before it says there are more. */
export const PAGES_SHOWN = 8

/** One line of the table: what a slide does with one host. */
export type TrafficRow = Readonly<{
  kind: Kind
  host: string
  /** The path first reported; the others are only counted. */
  path: string
  others: number
  /** Whether the host and kind hold as many records as are kept. */
  full: boolean
  /** Pages it was seen on, ascending. */
  pages: readonly number[]
  /** Seen while the slides opened, whichever page was on screen. */
  opening: boolean
}>

export type TrafficSummary = Readonly<{
  rows: readonly TrafficRow[]
  /** More was reported than the rows say. */
  more: boolean
}>

/** Where a row sorts: opening first, then by page, unknown pages last. */
const orderOf = (row: TrafficRow) =>
  row.opening ? 0 : (row.pages[0] ?? Number.POSITIVE_INFINITY)

const placeKey = (record: Traffic) => `${record.host}${record.path}`

/**
 * The pages a record was on. A browser's own report has none, so it takes
 * the pages the page script saw the same URL on.
 */
const pagesOf = (
  record: Traffic,
  seen: ReadonlyMap<string, readonly number[]>,
) =>
  record.page === PAGE_UNKNOWN
    ? (seen.get(placeKey(record)) ?? [])
    : [record.page]

const rowOf = (
  group: readonly Traffic[],
  kind: Kind,
  seen: ReadonlyMap<string, readonly number[]>,
  keptPerGroup: number,
): TrafficRow => {
  const pages = new Set(group.flatMap((record) => pagesOf(record, seen)))
  return {
    kind,
    host: group[0].host,
    path: group[0].path,
    others: new Set(group.map((record) => record.path)).size - 1,
    full: group.length >= keptPerGroup,
    pages: [...pages]
      .filter((page) => page > PAGE_OPENING)
      .sort((a, b) => a - b),
    opening: pages.has(PAGE_OPENING),
  }
}

/**
 * The table of a deployment's records, which arrive in the order they were
 * first reported. Records of one host and kind make one row. A sighting
 * without a kind makes no row. `kept` and `keptPerGroup` are the bounds the
 * records were kept under.
 */
export function summarize(
  records: readonly Traffic[],
  bounds: Readonly<{ kept: number; keptPerGroup: number }>,
): TrafficSummary {
  const seen = new Map<string, number[]>()
  const groups = new Map<string, { kind: Kind; records: Traffic[] }>()
  for (const record of records) {
    if (record.kind === SEEN) {
      const key = placeKey(record)
      seen.set(key, [...(seen.get(key) ?? []), record.page])
      continue
    }
    const key = `${record.kind} ${record.host}`
    const group = groups.get(key) ?? { kind: record.kind, records: [] }
    group.records.push(record)
    groups.set(key, group)
  }
  const rows = [...groups.values()].map((group) =>
    rowOf(group.records, group.kind, seen, bounds.keptPerGroup),
  )
  // The sort is stable, so rows of one page stay in reported order.
  rows.sort((a, b) => orderOf(a) - orderOf(b))
  return {
    rows: rows.slice(0, ROWS_SHOWN),
    more: rows.length > ROWS_SHOWN || records.length >= bounds.kept,
  }
}
