import { expect, test } from 'vitest'
import { eventRefOf } from '../events/event-url'
import { lumaEventKeys } from './ical'

const feed = (description: string) =>
  `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDESCRIPTION:${description}\r\nURL:https://lu.ma/kept\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`

test.each([
  ['dots', '.'],
  ['slashes', '/'],
  ['commas', ','],
])(
  'Given a DESCRIPTION with a Luma address and 2 MB of %s before a last letter, When the feed is read, Then it ends quickly and still reads the URL line',
  (_, run) => {
    const text = feed(`https://lu.ma/x${run.repeat(2 * 1024 * 1024)}a`)
    const started = performance.now()
    expect(lumaEventKeys(text)).toEqual(['https://luma.com/kept'])
    // Trimming with /[.,;:!?]+$/ took 16 seconds on 100 KB.
    expect(performance.now() - started).toBeLessThan(2000)
  },
)

test('Given many Luma addresses each with a long run of dots, When the feed is read, Then it ends quickly', () => {
  const line = `https://lu.ma/y${'.'.repeat(2000)}a `.repeat(30)
  const started = performance.now()
  lumaEventKeys(feed(line))
  expect(performance.now() - started).toBeLessThan(2000)
})

test('Given an address with 1 MB of slashes before a letter, When its event is read, Then it ends quickly', () => {
  const started = performance.now()
  expect(
    eventRefOf(`https://lu.ma/x${'/'.repeat(1024 * 1024)}a`)?.service,
  ).toBe('web')
  // oneTrailingSlash's /\/+$/ was quadratic on such a run.
  expect(performance.now() - started).toBeLessThan(2000)
})
