// What a run reports: the distribution of response times, the number of
// responses of each status, and the share of `429`. Pure: it reads the
// records the client kept and nothing else.

/**
 * One request as the client saw it. `status` is null when no response came
 * (the connection failed or timed out); `ms` is the time until the body had
 * been read, or until the failure.
 *
 * @typedef {{ name: string, status: number | null, ms: number }} Record
 */

/**
 * The value at the percentile, by nearest rank, of a list sorted ascending;
 * null for an empty list.
 *
 * @param {number[]} sorted
 * @param {number} percent from 0 to 100
 */
export function percentile(sorted, percent) {
  if (sorted.length === 0) return null
  const rank = Math.ceil((percent / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]
}

const round = (value) => (value === null ? null : Math.round(value * 10) / 10)

/** @param {number[]} times */
function latencyOf(times) {
  const sorted = [...times].sort((a, b) => a - b)
  return {
    min: round(sorted[0] ?? null),
    p50: round(percentile(sorted, 50)),
    p90: round(percentile(sorted, 90)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted.at(-1) ?? null),
  }
}

/** The status of a record as a key: its number, or `error`. */
const keyOf = (record) =>
  record.status === null ? 'error' : String(record.status)

/**
 * @param {Record[]} records
 * @returns {{
 *   total: number,
 *   byStatus: Record<string, number>,
 *   rate429: number,
 *   errors: number,
 *   latencyMs: ReturnType<typeof latencyOf>,
 *   byName: Record<string, { count: number, byStatus: Record<string, number>, latencyMs: ReturnType<typeof latencyOf> }>,
 * }}
 */
export function summarize(records) {
  const byStatus = {}
  const groups = new Map()
  for (const record of records) {
    const key = keyOf(record)
    byStatus[key] = (byStatus[key] ?? 0) + 1
    const group = groups.get(record.name) ?? []
    group.push(record)
    groups.set(record.name, group)
  }
  const byName = {}
  for (const [name, group] of groups) {
    const statuses = {}
    for (const record of group)
      statuses[keyOf(record)] = (statuses[keyOf(record)] ?? 0) + 1
    byName[name] = {
      count: group.length,
      byStatus: statuses,
      latencyMs: latencyOf(group.map((record) => record.ms)),
    }
  }
  return {
    total: records.length,
    byStatus,
    rate429: records.length === 0 ? 0 : (byStatus['429'] ?? 0) / records.length,
    errors: byStatus.error ?? 0,
    latencyMs: latencyOf(records.map((record) => record.ms)),
    byName,
  }
}

const statusLine = (byStatus) =>
  Object.entries(byStatus)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status}: ${count}`)
    .join(', ') || 'none'

const latencyLine = (latency) =>
  latency.p50 === null
    ? 'no requests'
    : `min ${latency.min}  p50 ${latency.p50}  p90 ${latency.p90}  p95 ${latency.p95}  p99 ${latency.p99}  max ${latency.max}`

/**
 * The report as text: the totals, then each kind of request.
 *
 * @param {ReturnType<typeof summarize>} summary
 * @param {{ scenario: string, target: string, seconds: number }} run
 */
export function renderSummary(summary, run) {
  const lines = [
    `Scenario: ${run.scenario}`,
    `Target: ${run.target}`,
    `Duration: ${run.seconds.toFixed(1)} s`,
    `Requests: ${summary.total} (${(summary.total / Math.max(run.seconds, 0.001)).toFixed(1)} per second)`,
    `Status: ${statusLine(summary.byStatus)}`,
    `429 share: ${(summary.rate429 * 100).toFixed(2)}%`,
    `Latency ms: ${latencyLine(summary.latencyMs)}`,
    '',
    'By request:',
  ]
  for (const [name, group] of Object.entries(summary.byName).sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    lines.push(
      `  ${name}: ${group.count} requests; ${statusLine(group.byStatus)}; ${latencyLine(group.latencyMs)}`,
    )
  return lines.join('\n')
}
