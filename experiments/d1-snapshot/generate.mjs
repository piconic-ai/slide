import { mkdir } from 'node:fs/promises'
import { devNull } from 'node:os'
import { resolve } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from '../../src/db/test-migrations.ts'

const destination = process.argv[2]
if (!destination)
  throw new Error('Expected a new directory for the D1 snapshot')
const path = resolve(destination)
await mkdir(path, { mode: 0o700 })
const platform = await getPlatformProxy({
  configPath: 'wrangler.jsonc',
  envFiles: [devNull],
  remoteBindings: false,
  persist: { path },
})
try {
  await applyMigrations(platform.env.DB)
} finally {
  await platform.dispose()
}
