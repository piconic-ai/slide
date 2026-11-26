import { z } from 'zod'
import { MAX_DAY_ROWS } from './day-query'

/** One line of a day's copy: a group of events and how many they were. */
export type DailyRow = Readonly<{
  event: string
  detail: string
  referrer: string
  lang: '' | 'ja' | 'en'
  screen: string
  /** The count, made up for sampling. */
  events: number
  /** The sum of the events' values, made up for sampling. */
  valueSum: number
}>

/** What the SQL API answered for one day, kept. */
export type DayCopy = Readonly<{
  rows: readonly DailyRow[]
  /** True when the day had more groups than a copy holds. */
  truncated: boolean
}>

// A 64-bit count comes back as a string from some ClickHouse settings, so a
// number and a number written out are both read.
const count = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^\d+(\.\d+)?$/u)
      .transform(Number),
  ])
  .pipe(z.number().finite().nonnegative())

const text = (max: number) => z.string().max(max)

const rowSchema = z.object({
  event: z.string().min(1).max(40),
  detail: text(200),
  referrer: text(253),
  lang: z
    .string()
    .transform((lang) => (lang === 'ja' || lang === 'en' ? lang : '')),
  screen: text(80),
  events: count,
  value_sum: count,
})

const responseSchema = z.object({ data: z.array(z.unknown()) })

/**
 * Reads the answer of the SQL API for one day. The answer is an outside
 * input: its rows are checked one by one, and an answer of another shape is
 * refused whole instead of copied halfway. Counts are rounded to whole
 * numbers; the value sum keeps its fraction.
 */
export function parseDayResponse(body: unknown): DayCopy {
  const response = responseSchema.parse(body)
  const rows = response.data.map((raw): DailyRow => {
    const row = rowSchema.parse(raw)
    return {
      event: row.event,
      detail: row.detail,
      referrer: row.referrer,
      lang: row.lang as DailyRow['lang'],
      screen: row.screen,
      events: Math.round(row.events),
      valueSum: row.value_sum,
    }
  })
  return { rows, truncated: rows.length >= MAX_DAY_ROWS }
}
