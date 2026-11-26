/**
 * Counts what one use of the service costs on the Cloudflare bill, as the
 * local run sees it: Worker requests, R2 operations by billing class, D1
 * rows read and written, and calls to `fetch`. Used by the per-use tests in
 * this directory; nothing here runs in the service.
 *
 * D1 reports rows read and written in the `meta` of `run`, `all` and `batch`
 * but not in `raw`, which Drizzle uses for most selects. A read-only
 * statement is therefore run a second time through `all` to learn its rows
 * read; its result still comes from `raw`. Other statements run once, through
 * `all`, and their rows (a RETURNING clause) are turned back into arrays.
 */

export type Usage = {
  /** Requests a client made to the Worker (the test counts them itself). */
  workerRequests: number
  /**
   * Calls the Worker made to its own cached entrypoints (stored files,
   * covers). Cloudflare bills these like requests when the entrypoint's
   * cache is on; see docs/dev/scale-cost.md.
   */
  internalRequests: number
  d1Queries: number
  d1RowsRead: number
  d1RowsWritten: number
  /** PutObject, CopyObject, ListObjects and multipart calls. */
  r2ClassA: number
  /** GetObject and HeadObject, found or not. */
  r2ClassB: number
  /** DeleteObject, which R2 does not bill. */
  r2Free: number
  /** Calls to the global `fetch`, which go to services outside Cloudflare. */
  fetches: number
}

export const emptyUsage = (): Usage => ({
  workerRequests: 0,
  internalRequests: 0,
  d1Queries: 0,
  d1RowsRead: 0,
  d1RowsWritten: 0,
  r2ClassA: 0,
  r2ClassB: 0,
  r2Free: 0,
  fetches: 0,
})

/** One statement as D1 ran it: its text, and the rows it read and wrote. */
export type StatementRecord = Readonly<{
  sql: string
  /** The values bound to its placeholders. */
  params: readonly unknown[]
  rowsRead: number
  rowsWritten: number
}>

const READ_ONLY = /^\s*(select|with)\b/i

type Meta = { rows_read?: number; rows_written?: number }

class CountedStatement {
  constructor(
    readonly inner: D1PreparedStatement,
    readonly sql: string,
    private readonly usage: Usage,
    private readonly counted: (
      usage: Usage,
      meta: Meta | undefined,
      sql: string,
      params: readonly unknown[],
    ) => void,
    private readonly factory: () => D1PreparedStatement,
    readonly params: readonly unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new CountedStatement(
      this.inner.bind(...values),
      this.sql,
      this.usage,
      this.counted,
      () => this.factory().bind(...values),
      values,
    )
  }

  async all<T = Record<string, unknown>>() {
    const result = await this.inner.all<T>()
    this.counted(this.usage, result.meta, this.sql, this.params)
    return result
  }

  async run<T = Record<string, unknown>>() {
    const result = await this.inner.run<T>()
    this.counted(this.usage, result.meta, this.sql, this.params)
    return result
  }

  async first<T = Record<string, unknown>>(column?: string) {
    const { results } = await this.all<Record<string, unknown>>()
    const row = results[0]
    if (row === undefined) return null
    return (column === undefined ? row : row[column]) as T
  }

  async raw<T = unknown[]>() {
    if (READ_ONLY.test(this.sql)) {
      const [raw, counted] = await Promise.all([
        this.inner.raw<T>(),
        this.factory().all(),
      ])
      this.counted(this.usage, counted.meta, this.sql, this.params)
      return raw
    }
    const { results } = await this.all<Record<string, unknown>>()
    return results.map((row) => Object.values(row)) as T[]
  }
}

function countingDatabase(
  database: D1Database,
  usage: Usage,
  log: StatementRecord[],
) {
  const counted = (
    target: Usage,
    meta: Meta | undefined,
    sql: string,
    params: readonly unknown[],
  ) => {
    target.d1Queries++
    target.d1RowsRead += meta?.rows_read ?? 0
    target.d1RowsWritten += meta?.rows_written ?? 0
    log.push({
      sql,
      params,
      rowsRead: meta?.rows_read ?? 0,
      rowsWritten: meta?.rows_written ?? 0,
    })
  }
  return new Proxy(database, {
    get(target, property) {
      if (property === 'prepare')
        return (sql: string) =>
          new CountedStatement(target.prepare(sql), sql, usage, counted, () =>
            target.prepare(sql),
          )
      if (property === 'batch')
        return async (statements: CountedStatement[]) => {
          const results = await target.batch(
            statements.map((statement) => statement.inner),
          )
          // A batch is one query for the limit of a Worker, one trip to D1.
          usage.d1Queries++
          results.forEach((result, at) => {
            usage.d1RowsRead += result.meta?.rows_read ?? 0
            usage.d1RowsWritten += result.meta?.rows_written ?? 0
            log.push({
              sql: statements[at]?.sql ?? '',
              params: statements[at]?.params ?? [],
              rowsRead: result.meta?.rows_read ?? 0,
              rowsWritten: result.meta?.rows_written ?? 0,
            })
          })
          return results
        }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

const CLASS_A = new Set([
  'put',
  'list',
  'createMultipartUpload',
  'resumeMultipartUpload',
])
const CLASS_B = new Set(['get', 'head'])

function countingBucket(bucket: R2Bucket, usage: Usage) {
  return new Proxy(bucket, {
    get(target, property) {
      const value = Reflect.get(target, property, target)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        if (CLASS_A.has(String(property))) usage.r2ClassA++
        else if (CLASS_B.has(String(property))) usage.r2ClassB++
        else if (property === 'delete') usage.r2Free++
        return value.apply(target, args)
      }
    },
  })
}

/**
 * The environment with D1 and R2 counted into `usage`, and the global
 * `fetch` replaced by a counter that refuses to leave the machine. Call
 * `restore` when done.
 */
export function counting(env: Env) {
  const usage = emptyUsage()
  const log: StatementRecord[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: unknown) => {
    usage.fetches++
    throw new Error(`The cost tests send nothing out: ${String(input)}`)
  }) as typeof fetch
  return {
    usage,
    /** Every statement since the last reset, in the order D1 ran them. */
    log,
    env: {
      ...env,
      DB: countingDatabase(env.DB, usage, log),
      UPLOADS: countingBucket(env.UPLOADS, usage),
    } as Env,
    reset() {
      Object.assign(usage, emptyUsage())
      log.length = 0
    },
    restore() {
      globalThis.fetch = realFetch
    },
  }
}
