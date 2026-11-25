import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['**/*.pure.{test,spec}.?(c|m)[jt]s?(x)'] },
})
