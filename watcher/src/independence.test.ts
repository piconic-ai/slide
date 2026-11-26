import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { unstable_readConfig } from 'wrangler'
import { parseTargets } from './watch-config'

/** The watcher's own source files, tests left out. */
async function sources(dir = 'watcher/src'): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter(
      (entry) => /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name),
    )
    .map((entry) => join(dir, entry.name))
}

test('F39-AC12: Given the watcher, When its imports are read, Then it reads nothing of the service: only its own files and packages', async () => {
  const imports: [string, string][] = []
  for (const path of await sources())
    for (const match of (await readFile(path, 'utf8')).matchAll(
      /(?:from|import)\s+['"]([^'"]+)['"]/g,
    ))
      imports.push([path, match[1]!])
  expect(imports.length).toBeGreaterThan(0)
  for (const [path, target] of imports)
    expect(
      target.startsWith('./') || target === 'zod',
      `${path} imports ${target}`,
    ).toBe(true)
})

test('F39-AC12: Given the watcher configuration, When it is read, Then it runs every five minutes, is not the service, and holds none of the service resources', () => {
  const config = unstable_readConfig({ config: 'watcher/wrangler.jsonc' })
  expect(config.name).toBe('slide-watcher')
  expect(config.triggers?.crons).toEqual(['*/5 * * * *'])
  expect(config.d1_databases ?? []).toEqual([])
  expect(config.r2_buckets ?? []).toEqual([])
  expect(config.routes ?? []).toEqual([])
  expect(config.assets).toBeUndefined()
  // It answers no request, so no public address is opened for it.
  expect(config.workers_dev).toBe(false)
  expect(config.preview_urls).toBe(false)
  expect(
    config.durable_objects.bindings.map(
      (b: { class_name: string }) => b.class_name,
    ),
  ).toEqual(['WatchState'])
})

test('F39-AC12: Given the addresses in the configuration, When they are read, Then top, viewer and content are all there', () => {
  const config = unstable_readConfig({ config: 'watcher/wrangler.jsonc' })
  expect(parseTargets(config.vars.WATCH_URLS)).not.toBeNull()
})
