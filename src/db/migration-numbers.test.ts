import { readdirSync } from 'node:fs'
import { expect, test } from 'vitest'

test('Given the checked-in migrations, When their numbers are read, Then they run from 0001 with no gap or repeat', () => {
  const numbers = readdirSync('migrations')
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.slice(0, 4))
    .sort()
  expect(numbers).toEqual(
    numbers.map((_, index) => String(index + 1).padStart(4, '0')),
  )
})
