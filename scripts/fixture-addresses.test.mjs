import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { realDomainAddresses } from './fixture-addresses.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const files = (directory) =>
  readdirSync(join(ROOT, directory), { recursive: true }).map(
    (file) => `${directory}/${String(file).replaceAll('\\', '/')}`,
  )

/** The data the load scripts and the demos make, and what the tests are given. */
const FIXTURES = [
  ...files('scripts').filter((path) =>
    /^scripts\/(load\/|demo-|.*\.test\.)/.test(path),
  ),
  ...files('src').filter((path) => /(\.test\.|\/test-[^/]*$)/.test(path)),
]
  .filter((path) => /\.(m?[jt]sx?|json|sql|csv)$/.test(path))
  // The test of this very check writes real domains, to be found.
  .filter((path) => path !== 'scripts/fixture-addresses.pure.test.mjs')

it('F43-AC16: Given the load scripts’ data, the demo scripts and the fixtures of the tests, When every address in them is read, Then each is on a domain that cannot be registered', () => {
  expect(FIXTURES.length).toBeGreaterThan(300)
  const found = FIXTURES.flatMap((path) =>
    realDomainAddresses(readFileSync(join(ROOT, path), 'utf8')).map(
      ({ line, address }) =>
        `${path}:${line} ${address} is not on example.com, example.org, example.net, .example, .test or .invalid; use an address on one of them, so that no test or demo writes to a real person`,
    ),
  )
  expect(found).toEqual([])
})

it('F43-AC16: Given the tracked files, When the load and demo scripts are listed, Then there are some to judge', () => {
  const tracked = execFileSync('git', ['ls-files', 'scripts'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  expect(tracked).toMatch(/scripts\/load\//)
  expect(tracked).toMatch(/scripts\/demo-/)
})
