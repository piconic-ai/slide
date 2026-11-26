import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { main } from './estimate-command.mjs'
import { PRICES } from './prices.mjs'
import { PER_USE } from './per-use.mjs'
import { renderPerUse, renderPrices } from './render.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const doc = readFileSync(join(ROOT, 'docs/dev/scale-cost.md'), 'utf8')

/** What the command prints for the arguments, on the day the prices were read. */
async function printed(argv) {
  const lines = []
  await main([...argv, '--as-of', '2026-11-26'], {
    today: () => '2026-11-26',
    readFile: async () => '{}',
    print: (text) => lines.push(text),
  })
  return lines.join('\n')
}

describe('docs/dev/scale-cost.md', () => {
  it('COST-AC11: Given the price table of the design, When it is compared with prices.mjs, Then it is the same text', () => {
    expect(doc).toContain(renderPrices(PRICES))
  })

  it('COST-AC11: Given the per-use table of the design, When it is compared with per-use.mjs, Then it is the same text', () => {
    expect(doc).toContain(renderPerUse(PER_USE))
  })

  it('COST-AC11: Given the tables of cost by monthly views, When they are computed again, Then they are the same text', async () => {
    expect(doc).toContain(await printed(['--table']))
    expect(doc).toContain(
      await printed([
        '--table',
        '--cache-hit-rate',
        '0.9',
        '--revisit-share',
        '0.5',
      ]),
    )
  })

  it('COST-AC3: Given the price table, When a row is read, Then it carries an official URL and a day, as the prices file does', () => {
    for (const [name, price] of Object.entries(PRICES)) {
      const row = doc
        .split('\n')
        .find((line) => line.startsWith(`| \`${name}\` |`))
      expect(row, name).toBeDefined()
      expect(row).toContain(price.source)
      expect(row).toContain(price.checkedOn)
    }
  })
})
