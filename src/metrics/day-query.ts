import { addDays, isDay, type Day } from './day'

/** The most rows one day is copied as; the most frequent ones are kept. */
export const MAX_DAY_ROWS = 500

const TABLE = /^[a-z][a-z0-9_]{0,63}$/

/** The name of the dataset the service writes to (`wrangler.jsonc`). */
export const DATASET = 'slide_events'

/**
 * The SQL that reads one UTC day of the dataset, summed by what the weekly
 * table is made of. Counts are `SUM(_sample_interval)` and the value is
 * weighted the same way, so that sampling is made up for (docs/dev/metrics.md).
 * The table's name and the day are checked, since they are put into the text.
 */
export function dayQuery(table: string, day: string): string {
  if (!TABLE.test(table)) throw new RangeError('Not a dataset name')
  if (!isDay(day)) throw new RangeError('Not a day')
  const next = addDays(day, 1)
  return [
    'SELECT',
    '  index1 AS event,',
    '  blob1 AS detail,',
    '  blob2 AS referrer,',
    '  blob3 AS lang,',
    '  blob5 AS screen,',
    '  SUM(_sample_interval) AS events,',
    '  SUM(double1 * _sample_interval) AS value_sum',
    `FROM ${table}`,
    `WHERE timestamp >= toDateTime('${day} 00:00:00')`,
    `  AND timestamp < toDateTime('${next satisfies Day} 00:00:00')`,
    'GROUP BY event, detail, referrer, lang, screen',
    'ORDER BY events DESC',
    `LIMIT ${MAX_DAY_ROWS}`,
    'FORMAT JSON',
  ].join('\n')
}
