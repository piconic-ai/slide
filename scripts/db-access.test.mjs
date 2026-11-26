import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Files that are not a store or a schema and still reach D1 (docs/dev/scale-cost.md,
 * D-145). This list only shrinks: move the query into a store when you touch
 * one of them. Never add a file; put new queries in `*-store.ts`.
 */
const KNOWN = [
  'src/auth/login-routes.ts',
  'src/auth/owner-session.ts',
  'src/uploads/api.ts',
]

const REACHES_D1 = /from 'drizzle-orm|\.prepare\(|\.batch\(/

describe('where SQL is written', () => {
  it('COST-AC12: Given the source tree, When the files outside stores and schemas are searched for Drizzle and prepared statements, Then only the known files reach D1', () => {
    const found = readdirSync(join(ROOT, 'src'), { recursive: true })
      .map((file) => `src/${String(file).replaceAll('\\', '/')}`)
      .filter((path) => /\.tsx?$/.test(path))
      .filter((path) => !/\.test\.|\/test-[^/]*$|\.d\.ts$/.test(path))
      .filter((path) => !/(^|[-/])store\.ts$|(^|[-/])schema\.ts$/.test(path))
      .filter((path) => REACHES_D1.test(readFileSync(join(ROOT, path), 'utf8')))
      .sort()
    expect(found).toEqual(KNOWN)
  })

  it('COST-AC12: Given each known file, When it is read, Then it still reaches D1, so the list holds no file that has been cleaned up', () => {
    for (const path of KNOWN)
      expect(readFileSync(join(ROOT, path), 'utf8')).toMatch(REACHES_D1)
  })
})
