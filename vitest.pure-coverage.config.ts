import { mergeConfig } from 'vitest/config'
import full from './vitest.config'
import pure from './vitest.pure.config'

// Coverage blobs must measure the same transformed source before merging.
export default mergeConfig(full, pure)
