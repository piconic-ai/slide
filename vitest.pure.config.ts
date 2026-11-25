import { mergeConfig } from 'vitest/config'
import coverageConfig from './vitest.coverage.config'

export default mergeConfig(coverageConfig, {
  test: { include: ['**/*.pure.{test,spec}.?(c|m)[jt]s?(x)'] },
})
