import { PAGE_OPENING, type Kind, type Traffic } from './traffic'

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

/**
 * The table of a deployment's records, which arrive in the order they were
 * first reported. Records of one host and kind make one row. `kept` and
 * `keptPerGroup` are the bounds the records were kept under.
 */
export function summarize(
  records: readonly Traffic[],
  bounds: Readonly<{ kept: number; keptPerGroup: number }>,
): TrafficSummary {
  const groups = new Map<string, Traffic[]>()
  for (const record of records) {
    const key = `${record.kind} ${record.host}`
    groups.set(key, [...(groups.get(key) ?? []), record])
  }
  const rows = [...groups.values()].map((group): TrafficRow => {
    const pages = new Set(group.map((record) => record.page))
    return {
      kind: group[0].kind,
      host: group[0].host,
      path: group[0].path,
      others: new Set(group.map((record) => record.path)).size - 1,
      full: group.length >= bounds.keptPerGroup,
      pages: [...pages]
        .filter((page) => page > PAGE_OPENING)
        .sort((a, b) => a - b),
      opening: pages.has(PAGE_OPENING),
    }
  })
  // The sort is stable, so rows of one page stay in reported order.
  rows.sort((a, b) => orderOf(a) - orderOf(b))
  return {
    rows: rows.slice(0, ROWS_SHOWN),
    more: rows.length > ROWS_SHOWN || records.length >= bounds.kept,
  }
}
