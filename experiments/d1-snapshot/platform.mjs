import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inject } from 'vitest'
import { getPlatformProxy } from 'wrangler'

export async function withSchema() {
  const dir = await mkdtemp(join(tmpdir(), 'slide-schema-copy-'))
  try {
    await cp(inject('slideSchemaTemplate'), dir, { recursive: true })
    const platform = await getPlatformProxy({ persist: { path: dir } })
    return {
      ...platform,
      async dispose() {
        try {
          await platform.dispose()
        } finally {
          await rm(dir, { recursive: true, force: true })
        }
      },
    }
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
}
