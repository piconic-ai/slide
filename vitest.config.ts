import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// Coverage is measured with `pnpm test:coverage`. The thresholds are a floor,
// not a target: they sit just under the measured values, and CI fails when a
// change lowers coverage below them. Raise them when coverage rises; do not
// lower them to make a change pass. The values come from CI (Linux); macOS
// measures a few branches differently. See docs/dev/development.md.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      coverage: {
        provider: 'v8',
        // Vitest matches these against absolute paths, so the patterns must
        // not depend on where the checkout lives.
        include: ['**/*.{ts,tsx}', 'scripts/**/*.mjs'],
        exclude: [
          '**/node_modules/**',
          '**/dist/**',
          '**/public/**',
          '**/*.config.ts',
          '**/*.test.*',
          '**/*.d.ts',
          '**/src/**/test-*.ts',
          // Run as child processes or by hand, where v8 cannot see them.
          // upload.mjs is exercised by scripts/upload*.test.mjs and the
          // local upload check.
          '**/scripts/upload.mjs',
          '**/scripts/verify-upload.mjs',
          '**/scripts/demo-reactions.mjs',
        ],
        reporter: ['text-summary', 'json-summary'],
        reportsDirectory: 'coverage',
        thresholds: { statements: 93, branches: 89, functions: 87, lines: 94 },
      },
    },
  }),
)
