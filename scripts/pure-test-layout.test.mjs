import { globSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { pureTestViolations } from './pure-test-dependencies.mjs'

test('Given the test tree, When following runtime imports, Then test names distinguish pure suites from suites using external state', () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const files = globSync('**/*.?(c|m)[jt]s?(x)', {
    cwd: root,
    exclude: [
      '**/node_modules/**',
      '.*/**',
      'coverage/**',
      'dist/**',
      'public/components/**',
      '**/*.d.?(c|m)ts',
    ],
  })
  const sources = new Map(
    files.map((path) => [
      path.split(sep).join('/'),
      readFileSync(join(root, path), 'utf8'),
    ]),
  )
  expect(pureTestViolations(sources)).toEqual([])
})
