import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { violations } from './layers.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Files whose name says "pure" but which reach outside, with what each uses.
 * This list only shrinks: rename or split a file when you touch it, and
 * delete its entry. Never add one; give a new file a name that says its layer.
 */
const KNOWN = {
  'src/auth/owner-session.ts': [
    'hono',
    'drizzle-orm',
    'env',
    'random',
    'store',
  ],
  'src/preview/config.ts': ['env'],
  'src/publication/author.ts': ['binding', 'store'],
  'src/site/errors.ts': ['hono', 'env'],
  'src/site/lang.ts': ['hono'],
  'src/site/rate-limit.ts': ['env'],
}

describe('the source tree', () => {
  const files = readdirSync(join(ROOT, 'src'), { recursive: true })
    .map((file) => `src/${String(file).replaceAll('\\', '/')}`)
    .filter((path) => /\.tsx?$/.test(path))
    .filter((path) => !/\.test\.|\.d\.ts$|\/test-[^/]*$/.test(path))
  const found = Object.fromEntries(
    files
      .map((path) => [
        path,
        violations(path, readFileSync(join(ROOT, path), 'utf8')),
      ])
      .filter(([, labels]) => labels.length > 0),
  )

  it('When every source file is judged by its name, then only the known files reach outside their layer, and exactly as recorded', () => {
    expect(found).toEqual(KNOWN)
  })
})
