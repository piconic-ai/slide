import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// Coverage is measured with `pnpm test:coverage`. The thresholds are a floor,
// not a target: they sit just under the measured values, and CI fails when a
// change lowers coverage below them. Raise them when coverage rises; do not
// lower them to make a change pass. See docs/dev/development.md.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}', 'scripts/**/*.mjs'],
        exclude: [
          '**/*.test.*',
          '**/*.d.ts',
          'src/**/test-*.ts',
          'src/db/test-migrations.ts',
          // Run as child processes or by hand, where v8 cannot see them.
          // upload.mjs is exercised by scripts/upload*.test.mjs and the
          // local upload check.
          'scripts/upload.mjs',
          'scripts/verify-upload.mjs',
          'scripts/demo-reactions.mjs',
          'scripts/home-ssg.mjs',
        ],
        reporter: ['text-summary', 'json-summary'],
        reportsDirectory: 'coverage',
        thresholds: { statements: 94, branches: 91, functions: 90, lines: 95 },
      },
    },
  }),
)
