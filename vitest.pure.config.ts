import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    maxWorkers: process.env.GITHUB_ACTIONS === 'true' ? undefined : 2,
    include: ['**/*.pure.{test,spec}.?(c|m)[jt]s?(x)'],
  },
})
