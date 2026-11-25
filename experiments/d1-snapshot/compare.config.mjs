import { defineConfig, mergeConfig } from 'vitest/config'
import base from '../../vitest.config.ts'

const prebuilt = process.env.SLIDE_BENCH_FIXTURE === 'prebuilt'
const open = /await getPlatformProxy(?:<Env>)?\(\{ persist: false \}\)/g
const onlyMigration =
  /^beforeAll\(\(\) => applyMigrations\((db|database|platform\.env\.DB)\)\)$/m
const atTopLevel = /^await applyMigrations\(db\)$/m
const firstInSetup =
  /^(beforeAll\(async \(\) => \{\n)  await applyMigrations\((db|database|platform\.env\.DB)\)\n/m

// Match suites that open one fresh platform and replay all migrations once.
// Migration history tests and custom setups still run their original code.
const replaceFreshSchema = {
  name: 'benchmark-prebuilt-d1',
  enforce: 'pre',
  transform(source, id) {
    if (
      !/\.test\.(ts|mjs)$/.test(id) ||
      !source.includes("from 'wrangler'") ||
      source.match(open)?.length !== 1 ||
      source.split('applyMigrations(').length !== 2
    )
      return
    const setup = source
      .replace(onlyMigration, '')
      .replace(atTopLevel, '')
      .replace(firstInSetup, '$1')
    if (setup === source) return
    console.log('[snapshot fixture]', id)
    return (
      "import { withSchema } from '/experiments/d1-snapshot/platform.mjs'\n" +
      setup.replace(open, 'await withSchema()')
    )
  },
}

export default mergeConfig(
  base,
  defineConfig({
    test: { setupFiles: ['experiments/d1-snapshot/trace.mjs'] },
    plugins: prebuilt ? [replaceFreshSchema] : [],
  }),
)
