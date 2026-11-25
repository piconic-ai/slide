import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
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

const read = async (path: string) => ({
  path,
  code: (await readFile(path, 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|\s)\/\/ .*$/gmu, ''),
})

// A call of fetch, or of a fetch held under another name.
const FETCH = /(?<![.\w])fetch\(|globalThis\.fetch|self\.fetch/gu
const LUMA_FEED_HOST = /api\.lu\.ma/u

test('F33-AC17: Given the source, When the calls of fetch are found, Then the only one beside the Luma feed host is the one in the Luma client', async () => {
  const files = await Promise.all((await sources()).map(read))
  const client = files.find((file) => file.path === 'src/feeds/luma-client.ts')
  expect(client?.code.match(FETCH)).toHaveLength(1)
  // The host is written in one place, which no fetch shares.
  const naming = files
    .filter((file) => LUMA_FEED_HOST.test(file.code))
    .map((file) => file.path)
    .sort()
  expect(naming).toEqual([
    // The form's hint and the check of a typed link; they ask nothing.
    'src/communities/link-fields.ts',
    'src/communities/link-rules.ts',
    'src/feeds/luma-url.ts',
  ])
  for (const file of files.filter((file) => naming.includes(file.path)))
    expect(file.code.match(FETCH), file.path).toBeNull()
  // What builds the address is read by no file but the client and the
  // pure modules of the feeds.
  const users = files
    .filter((file) => /from '(\.\.\/feeds|\.)\/luma-url'/u.test(file.code))
    .map((file) => file.path)
  for (const path of users) expect(path).toMatch(/^src\/feeds\//u)
  const fetching = files.filter(
    (file) => file.code.match(FETCH) !== null && users.includes(file.path),
  )
  expect(fetching.map((file) => file.path)).toEqual([
    'src/feeds/luma-client.ts',
  ])
})
