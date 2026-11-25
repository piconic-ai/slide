import { expect, test } from 'vitest'
import { TITLE_SCAN_BYTES } from './title'
import { descriptionOf } from './description'

const scanned = (unit: string) =>
  unit
    .repeat(Math.ceil(TITLE_SCAN_BYTES / unit.length))
    .slice(0, TITLE_SCAN_BYTES)

test.each([
  ['open metas', '<meta'],
  ['metas with an unclosed quote', '<meta content="'],
  ['metas without an end', '<meta a '],
  ['attributes without a value', '<meta a= '],
  ['comments without an end', '<!--'],
  ['raw text without an end', '<script>'],
])(
  'Given a scan full of %s, When the description is read, Then it answers quickly',
  (_, unit) => {
    const started = performance.now()

    descriptionOf(scanned(unit))

    expect(performance.now() - started).toBeLessThan(1000)
  },
)
