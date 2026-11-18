import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from 'vitest'

/** CSS colors are 3, 6, or 8 hex digits. 4-digit issue refs such as #3894 stay out. */
const HEX_COLOR =
  /(?<![0-9A-Za-z])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9A-Za-z])/g

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.css'])

const allowed = (relative: string) =>
  relative === 'src/site/design-tokens.ts' ||
  relative.includes('.test.') ||
  relative.split(path.sep).includes('examples')

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return filesUnder(full)
      return SOURCE_EXT.has(path.extname(entry.name)) ? [full] : []
    }),
  )
  return nested.flat()
}

async function hexHits() {
  const root = process.cwd()
  const files = (
    await Promise.all(
      ['src', 'components'].map((dir) => filesUnder(path.join(root, dir))),
    )
  ).flat()
  const hits: string[] = []
  for (const file of files) {
    const relative = path.relative(root, file)
    if (allowed(relative)) continue
    const text = await readFile(file, 'utf8')
    for (const [index, line] of text.split('\n').entries()) {
      if (line.match(HEX_COLOR)) hits.push(`${relative}:${index + 1}`)
    }
  }
  return hits
}

test('Given service and component sources, When scanned, Then hex colors remain only in the design tokens', async () => {
  expect(await hexHits()).toEqual([])
})
