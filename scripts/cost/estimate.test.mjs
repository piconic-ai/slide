import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'estimate.mjs')
const run = promisify(execFile)

describe('scripts/cost/estimate.mjs as a process', () => {
  it('COST-AC1: Given 10,000 views a month, When the command runs, Then it prints the $5 minimum and exits 0', async () => {
    const { stdout } = await run('node', [
      ENTRY,
      '--views',
      '10000',
      '--as-of',
      '2026-11-26',
    ])
    expect(stdout).toContain('Total: $5.00 a month')
  })

  it('COST-AC1: Given a bad option, When the command runs, Then it prints the reason on stderr and exits 1', async () => {
    const result = await run('node', [ENTRY, '--views', 'many']).catch(
      (error) => error,
    )
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('needs a number')
    expect(result.stdout).toBe('')
  })
})
