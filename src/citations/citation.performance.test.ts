import { expect, test } from 'vitest'
import { citationsOf } from './citation'

const ORIGIN = 'https://slide.example'

test('Given two megabytes of links that are no URL at all, When read, Then the reading ends quickly without a citation', () => {
  const html = 'href=a '.repeat(300_000)
  const started = performance.now()

  expect(citationsOf(html, ORIGIN)).toEqual([])

  // Parsing each one failed slowly: ten megabytes took over ten seconds.
  expect(performance.now() - started).toBeLessThan(3000)
})
