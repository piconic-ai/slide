import { defineConfig, mergeConfig } from 'vitest/config'
import base from '../../vitest.config.ts'

const snapshot = process.env.SLIDE_BENCH_FIXTURE === 'snapshot'
const open = 'await getPlatformProxy<Env>({ persist: false })'
const onlyMigration =
  /^beforeAll\(\(\) => applyMigrations\((db|database|platform\.env\.DB)\)\)$/m
const firstInSetup =
  /^(beforeAll\(async \(\) => \{\n)  await applyMigrations\((db|database|platform\.env\.DB)\)\n/m

// Benchmark branch only. Substitute the fixture in suites that start with one
// fresh platform and apply all migrations before any test. Keep migrations
// against historical schemas, rollback checks, and custom setups as written.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      globalSetup: snapshot ? ['experiments/d1-snapshot/template.mjs'] : [],
    },
    plugins: snapshot
      ? [
          {
            name: 'benchmark-local-d1-snapshot',
            enforce: 'pre',
            transform(source, id) {
              if (
                !id.endsWith('.test.ts') ||
                !source.includes("from 'wrangler'")
              )
                return
              if (
                source.split(open).length !== 2 ||
                source.split('applyMigrations(').length !== 2
              )
                return
              if (!onlyMigration.test(source) && !firstInSetup.test(source))
                return
              console.log('[snapshot fixture]', id)
              const body = source
                .replace(open, 'await withSchema()')
                .replace(onlyMigration, '')
                .replace(firstInSetup, '$1')
              return (
                "import { withSchema } from '/experiments/d1-snapshot/platform.mjs'\n" +
                body
              )
            },
          },
        ]
      : [],
  }),
)
