import { resolve } from 'node:path'
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
      // @barefootjs/test 0.41.3's ESM bundle lacks TypeScript's Node host.
      // Its published source entry imports the project's BarefootJS compiler.
      alias: {
        '@barefootjs/test': resolve(
          import.meta.dirname,
          'node_modules/@barefootjs/test/src/index.ts',
        ),
      },
      // Concurrent local worktrees each start their own workerd and browser processes.
      maxWorkers: process.env.GITHUB_ACTIONS === 'true' ? undefined : 1,
      // A test without its own timeout fails only when it is stuck: past
      // five times its 5 s budget. TEST_TIMEOUT_MS in scripts/slow-tests.mjs.
      testTimeout: 25_000,
      // A hook fails only when it is stuck: a slow one, such as a dispose
      // that takes over 10 s on a busy runner, is warned about by
      // scripts/slow-test-reporter.mjs instead (#546).
      // HOOK_TIMEOUT_MS in scripts/slow-tests.mjs.
      hookTimeout: 60_000,
      reporters: ['default', './scripts/slow-test-reporter.mjs'],
      globalSetup: ['./src/test-browser-server.ts'],
      setupFiles: ['./src/test-browser-setup.ts'],
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
          '**/scripts/demo-citations.mjs',
          '**/scripts/demo-scope4.mjs',
          // The release commands, run as child processes by
          // scripts/release-deploy.test.mjs; their logic is in the modules they call.
          '**/scripts/release-deploy.mjs',
          '**/scripts/post-deploy-check.mjs',
          // The command line around er-generate.mjs; its logic is tested there.
          '**/scripts/db-er.mjs',
          // The command line around db-export-plan.mjs, run as a child process
          // by scripts/db-export-without-email.test.mjs.
          '**/scripts/db-export-without-email.mjs',
          // Runs in the browser, in the bundle /components/assets/router.js;
          // src/site/router.browser.test.ts drives it, where v8 cannot see it.
          '**/src/site/router-entry.ts',
        ],
        reporter: ['text-summary', 'json-summary'],
        reportsDirectory: 'coverage',
        thresholds: { statements: 93, branches: 89, functions: 87, lines: 94 },
      },
    },
  }),
)
