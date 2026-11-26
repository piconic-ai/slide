import type { DataPoint } from './events'

/**
 * Writes one row to the dataset. Analytics Engine takes the write and answers
 * at once; nothing waits for it to be stored, so a write never holds up a
 * response. A write that throws is logged by the event's name and is lost:
 * counting is never worth failing for (F40-AC24). With no dataset (the
 * binding is not there, D-08) it does nothing.
 *
 * Returns whether the row was handed over.
 */
export function writeDataPoint(
  dataset: AnalyticsEngineDataset | undefined,
  point: DataPoint,
): boolean {
  if (!dataset) return false
  try {
    dataset.writeDataPoint({
      indexes: point.indexes,
      blobs: point.blobs,
      doubles: point.doubles,
    })
    return true
  } catch {
    console.error(
      JSON.stringify({ event: 'metric_write_failed', name: point.indexes[0] }),
    )
    return false
  }
}
