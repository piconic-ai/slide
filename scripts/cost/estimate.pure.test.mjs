import { describe, expect, it } from 'vitest'
import { TABLE_VIEWS, inputsFor } from './defaults.mjs'
import { main, mergePerUse, parseArgs } from './estimate-command.mjs'
import { estimate } from './formula.mjs'
import { PER_USE } from './per-use.mjs'

/** Runs the command with a fixed day and the files it is given. */
async function run(argv, files = {}) {
  const printed = []
  await main(argv, {
    today: () => '2026-11-26',
    readFile: async (path) => {
      if (!(path in files)) throw new Error(`no file ${path}`)
      return files[path]
    },
    print: (text) => printed.push(text),
  })
  return printed.join('\n')
}

describe('the estimate command', () => {
  it('COST-AC1: Given --views, When it runs, Then it prints the total of the formula for the default inputs', async () => {
    const expected = estimate({ ...inputsFor(100_000), asOf: '2026-11-26' })
    const text = await run(['--views', '100000'])
    expect(text).toContain(`Total: $${expected.usd.toFixed(2)} a month`)
    expect(text).toContain('Estimate for 100,000 views a month')
  })

  it('COST-AC1: Given --table, When it runs, Then it prints one row for each of 10 thousand, 100 thousand, 1 million and 10 million views', async () => {
    const text = await run(['--table'])
    const rows = text.split('\n').slice(2)
    expect(rows).toHaveLength(4)
    for (const [at, views] of TABLE_VIEWS.entries())
      expect(rows[at]).toContain(views.toLocaleString('en-US'))
  })

  it('COST-AC1: Given --json, When it runs, Then the inputs and the items come out as JSON', async () => {
    const parsed = JSON.parse(await run(['--views', '5000', '--json']))
    expect(parsed.inputs.views).toBe(5000)
    expect(parsed.result.items.some((item) => item.key === 'r2ClassB')).toBe(
      true,
    )
  })

  it('COST-AC1: Given a file of production counts, When it runs, Then those fields replace the defaults and the rest stay', async () => {
    const files = {
      'measured.json': JSON.stringify({
        view: { workerRequests: 1, internalRequests: 0 },
      }),
    }
    const text = await run(
      ['--views', '10000000', '--per-use', 'measured.json', '--json'],
      files,
    )
    const { inputs } = JSON.parse(text)
    expect(inputs.view.workerRequests).toBe(1)
    expect(inputs.view.internalRequests).toBe(0)
    expect(inputs.view.d1RowsRead).toBe(PER_USE.normal.view.d1RowsRead)
  })

  it('COST-AC1: Given --size and --list, When it runs, Then the counts of that size and that screen are used', async () => {
    const { inputs } = JSON.parse(
      await run(['--size', 'large', '--list', 'profile', '--json']),
    )
    expect(inputs.view).toEqual(PER_USE.large.view)
    expect(inputs.list).toEqual(PER_USE.list.profile)
  })

  it('COST-AC1: Given --as-of on either side of 2026-12-01, When it runs, Then the log item changes its unit', async () => {
    const at = async (day) =>
      JSON.parse(
        await run(['--views', '1000000', '--as-of', day, '--json']),
      ).result.items.find((item) => item.key === 'logs').unit
    expect([await at('2026-11-30'), await at('2026-12-01')]).toEqual([
      'events',
      'GB',
    ])
  })

  it.each([
    [['--views']],
    [['--views', 'many']],
    [['--views', '']],
    [['--views', '-5']],
    [['--cache-hit-rate', '2']],
    [['--size', 'huge']],
    [['--list', 'nowhere']],
    [['--no-such-flag']],
    [['--as-of', 'today']],
    [['--per-use', 'missing.json']],
  ])(
    'COST-AC1: Given the bad arguments %j, When it runs, Then it fails',
    async (argv) => {
      await expect(run(argv)).rejects.toThrow()
    },
  )

  it('COST-AC1: Given a per-use file naming an unknown use, When it is merged, Then it is refused', () => {
    expect(() => mergePerUse(inputsFor(1), { views: {} })).toThrow(
      /Unknown use/,
    )
    expect(parseArgs(['--backup']).backup).toBe(true)
    expect(parseArgs(['--no-backup']).backup).toBe(false)
  })
})
