import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from '../../src/db/test-migrations.ts'

export default async function setup(project) {
  const dir = await mkdtemp(join(tmpdir(), 'slide-schema-template-'))
  try {
    const source = await getPlatformProxy({ persist: { path: dir } })
    try {
      await applyMigrations(source.env.DB)
    } finally {
      await source.dispose()
    }
    project.provide('slideSchemaTemplate', dir)
    return () => rm(dir, { recursive: true, force: true })
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
}
