import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { isHelpPath } from './catalog'
import { HELP_CATALOG } from './default-catalog'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The service's own source: no tests, no declarations. */
const sources = readdirSync(SRC, { recursive: true })
  .map((file) => String(file).replaceAll('\\', '/'))
  .filter((file) => /\.tsx?$/.test(file))
  .filter((file) => !/\.test\.|\.d\.ts$|(^|\/)test-[^/]*$/.test(file))
  .map((file) => [file, readFileSync(join(SRC, file), 'utf8')] as const)

test('F36-AC26: Given the service’s source, When it is searched, Then no link to a section’s place, `/help#`, is left, nor the helpers that made one', () => {
  const found = sources
    .filter(([, text]) =>
      /\/help#|helpSectionPath|helpLink\(|HELP_SECTION_IDS/.test(text),
    )
    .map(([file]) => file)
  expect(found).toEqual([])
})

test('F36-AC48: Given every link to the help written in the source, When it is read, Then it is the entrance, an aim, an article or the bot', () => {
  const paths = sources.flatMap(([file, text]) =>
    [...text.matchAll(/["'`](\/help(?:\/[a-z0-9-]+){0,2})["'`?]/g)].map(
      (match) => [file, match[1]!] as const,
    ),
  )
  expect(paths.length).toBeGreaterThan(0)
  for (const [file, path] of paths)
    expect([file, isHelpPath(HELP_CATALOG, path)]).toEqual([file, true])
})

test('F36-AC48: Given every call that makes a link to an article, When it is read, Then the article exists', () => {
  const calls = sources.flatMap(([file, text]) =>
    [
      ...text.matchAll(
        /helpArticle(?:Link|Path)\(\s*'([a-z]+)',\s*'([a-z0-9-]+)'/g,
      ),
    ].map((match) => [file, `${match[1]}/${match[2]}`] as const),
  )
  expect(calls.length).toBeGreaterThan(0)
  const keys = HELP_CATALOG.map((entry) => entry.key)
  for (const [file, key] of calls)
    expect([file, keys.includes(key)]).toEqual([file, true])
})
