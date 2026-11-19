// Slides are no longer sent from GitHub Actions, so the repository ships no
// action and runs no workflow that tries one.
import { readdir, readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

const WORKFLOWS = '.github/workflows'

const workflows = async () =>
  Promise.all(
    (await readdir(WORKFLOWS))
      .filter((name) => /\.ya?ml$/.test(name))
      .map(async (name) => ({
        name,
        text: await readFile(`${WORKFLOWS}/${name}`, 'utf8'),
      })),
  )

test('F22-AC30: Given the root of the repository, When its files are listed, Then no action.yml or action.yaml is there', async () => {
  const root = await readdir('.')

  expect(root).not.toContain('action.yml')
  expect(root).not.toContain('action.yaml')
})

test('F22-AC30: Given the workflows, When they are read, Then only the checks of this repository are there, and none uses an action of this repository or the uploader', async () => {
  const found = await workflows()

  expect(found.map(({ name }) => name).sort()).toEqual([
    'ci.yml',
    'pullfrog.yml',
  ])
  for (const { name, text } of found) {
    expect(text, name).not.toMatch(/uses:\s*\.\/\s*$/m)
    expect(text, name).not.toMatch(/upload\.mjs|SLIDE_ID|SLIDE_UPLOAD/)
  }
})

test('F22-AC30: Given the workflow lockfile, When it is read, Then it pins only workflows that exist', async () => {
  const lock = await readFile(`${WORKFLOWS}/actions.lock`, 'utf8')
  const pinned = [...lock.matchAll(/^ {4}'(\.github\/workflows\/[^']+)':/gm)]
    .map(([, path]) => path)
    .sort()

  expect(pinned).toEqual(
    (await workflows()).map(({ name }) => `${WORKFLOWS}/${name}`).sort(),
  )
})
