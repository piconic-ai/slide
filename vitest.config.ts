import { mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'
import coverageConfig from './vitest.coverage.config'

export default mergeConfig(mergeConfig(viteConfig, coverageConfig), {
  test: { setupFiles: ['./src/test-browser-setup.ts'] },
})
