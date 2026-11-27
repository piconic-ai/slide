import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'

// Options the Workers runtime does not implement throw when a request is
// made, which a stub of `fetch` in a test never shows. The one that has bitten
// is `redirect: 'error'` (the metrics copy failed every night with a
// TypeError, 2026-11-26): Workers accepts `follow` and `manual` only
// (https://developers.cloudflare.com/workers/runtime-apis/request/). This
// reads the Worker code as text, since nothing else runs it with the runtime.

const ROOTS = ['src', 'watcher/src']
const TEST_FILE = /\.(test|browser\.test|pure\.test)\.[cm]?[jt]sx?$/

async function sources(dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await sources(path)))
    else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !TEST_FILE.test(entry.name))
      found.push(path)
  }
  return found
}

test('F40-AC17: Given the Worker code, When it is searched for a redirect mode Workers does not implement, Then there is none (use manual and check the status)', async () => {
  const offending = []
  for (const root of ROOTS)
    for (const path of await sources(root)) {
      const code = (await readFile(path, 'utf8')).replace(/^\s*\/\/.*$/gm, '')
      if (/redirect\s*:\s*['"`]error['"`]/.test(code)) offending.push(path)
    }
  expect(offending).toEqual([])
})
