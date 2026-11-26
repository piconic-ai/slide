import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { articleKeys, isCurrent } from './help-registry.mjs'

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  'help-registry.mjs',
)
const made = []
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

describe('the help’s article files', () => {
  it('F36-AC12: Given the article files in the repository, When the registry is read, Then it lists exactly those files', () => {
    expect(isCurrent()).toBe(true)
  })

  it('F36-AC12: Given the check command, When it runs on the repository, Then it exits 0', () => {
    execFileSync('node', [SCRIPT, '--check'], { stdio: 'pipe' })
  })

  it('F36-AC12: Given a directory of article files, When the keys are read, Then only <aim>/<slug>.ts files count, sorted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'help-articles-'))
    made.push(dir)
    for (const file of ['start/b.ts', 'start/a.ts', 'slides/z.ts']) {
      mkdirSync(join(dir, dirname(file)), { recursive: true })
      writeFileSync(join(dir, file), '')
    }
    // Not articles: a file at the top, a deeper one, another kind of file.
    writeFileSync(join(dir, 'top.ts'), '')
    mkdirSync(join(dir, 'start/deep'), { recursive: true })
    writeFileSync(join(dir, 'start/deep/x.ts'), '')
    writeFileSync(join(dir, 'start/notes.md'), '')
    expect(articleKeys(dir)).toEqual(['slides/z', 'start/a', 'start/b'])
  })
})
