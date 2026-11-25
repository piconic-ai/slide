import { expect, test } from 'vitest'
import { TITLE_SCAN_BYTES, titleOf } from './title'

const scanned = (unit: string) =>
  unit
    .repeat(Math.ceil(TITLE_SCAN_BYTES / unit.length))
    .slice(0, TITLE_SCAN_BYTES)

test.each([
  ['open tags', '<a'],
  ['tags with an unclosed quote', '<a x="'],
  ['tags without an end', '<a b '],
  ['quoted attributes without an end', '<a x="y" '],
  ['raw text without an end', '<script>'],
  ['comments without an end', '<!--'],
  ['titles without an end', '<title>'],
  ['titles with unclosed attributes', '<title x="'],
])(
  'Given %s filling the scanned bytes, When the title is read, Then it finishes quickly',
  (_, unit) => {
    const started = performance.now()
    titleOf(scanned(unit))
    expect(performance.now() - started).toBeLessThan(500)
  },
)
