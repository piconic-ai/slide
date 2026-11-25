import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import { expect, test } from 'vitest'

/** Every source file under src/, tests and test helpers left out. */
async function sources(dir = 'src'): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sources(path)
      return /\.tsx?$/u.test(entry.name) &&
        !/\.test\.tsx?$|test-[^/]*\.ts$|\.d\.ts$/u.test(entry.name)
        ? [path]
        : []
    }),
  )
  return nested.flat()
}

type Source = Readonly<{ path: string; code: string; imports: string[] }>

/** A source with its comments dropped and its relative imports resolved. */
const read = async (path: string): Promise<Source> => {
  const text = await readFile(path, 'utf8')
  return {
    path,
    code: text
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/(^|\s)\/\/ .*$/gmu, ''),
    // Static and dynamic imports alike, type-only ones too: any of them
    // reaching the address module counts.
    imports: [...text.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/gu)]
      .map(([, module]) => normalize(join(dirname(path), module ?? '')))
      .map((module) => module.replace(/\.tsx?$/u, '')),
  }
}

// Any mention of fetch: a call, an alias (`const send = fetch`), a
// property (`globalThis.fetch`) or a name in a string (`globalThis['fetch']`).
const FETCH = /\bfetch\b/gu
const LUMA_FEED_HOST = /api\.lu\.ma/u
const URL_MODULE = 'src/feeds/luma-url'
const CLIENT = 'src/feeds/luma-client.ts'

test('F33-AC17: Given the source, When it is searched, Then the Luma client is the one place that both reaches the feed address and mentions fetch, once', async () => {
  const files = await Promise.all((await sources()).map(read))
  const client = files.find((file) => file.path === CLIENT)
  expect(client?.code.match(FETCH)).toHaveLength(1)
  expect(client?.imports).toContain(URL_MODULE)
  // The host is written where the address is checked and built, and in
  // two files of work C that only check what a person typed.
  expect(
    files
      .filter((file) => LUMA_FEED_HOST.test(file.code))
      .map((file) => file.path)
      .sort(),
  ).toEqual([
    'src/communities/link-fields.ts',
    'src/communities/link-rules.ts',
    'src/feeds/luma-url.ts',
  ])
  // The origin's constant is not taken anywhere else by name.
  for (const file of files.filter((file) => file.path !== `${URL_MODULE}.ts`))
    expect(file.code, file.path).not.toMatch(/\bLUMA_FEED_ORIGIN\b/u)
  // No other file that names the host or reads the address module, by
  // any relative path, mentions fetch at all.
  const near = files.filter(
    (file) =>
      file.path !== CLIENT &&
      (LUMA_FEED_HOST.test(file.code) || file.imports.includes(URL_MODULE)),
  )
  for (const file of near) expect(file.code.match(FETCH), file.path).toBeNull()
})
