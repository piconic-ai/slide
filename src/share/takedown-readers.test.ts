import { readdir, readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { applyOperatorCommand } from '../publication/takedown-store'
import {
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  BROWSER: {
    shoot: async () =>
      new Response('jpeg bytes', { headers: { 'Content-Type': 'image/jpeg' } }),
  },
} as unknown as Env

let talk = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  // Signing in records the handle `owner` that share URLs carry.
  await signIn(env)
  talk = await seedPublic(db, 'talk', 100, 'Hidden talk')
  await seedPublic(db, 'other', 200, 'Other talk')
})
afterAll(() => platform.dispose())

const get = (path: string) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`), env)
const hide = () =>
  applyOperatorCommand(db, {
    deckId: 'talk',
    command: { kind: 'hide', reason: 'fake sign-in page', operator: 'op' },
    now: 300,
  })
const release = () =>
  applyOperatorCommand(db, {
    deckId: 'talk',
    command: { kind: 'release' },
    now: 400,
  })

test('F17-AC7: Given a public deck, When an operator hides it, Then its share URL answers like a missing deck, and a release brings it back', async () => {
  expect((await get('/@owner/talk')).status).toBe(200)
  const missing = await get('/@owner/no-such-deck')
  await hide()
  const hidden = await get('/@owner/talk')
  expect(hidden.status).toBe(missing.status)
  expect(await hidden.text()).not.toContain('Hidden talk')
  expect((await get('/@owner/other')).status).toBe(200)
  await release()
  expect((await get('/@owner/talk')).status).toBe(200)
})

test('F17-AC8: Given a public deck, When an operator hides it, Then the recent list and the profile list leave it out and keep the others', async () => {
  // A browser fetching this list again may reuse an older response for up to
  // 60 seconds (max-age=60); that delay is accepted, see
  // docs/dev/f17-takedown.md. What is checked here is that a fresh response
  // leaves the deck out.
  const before = await (await get('/api/public/slides')).text()
  expect(before).toContain('Hidden talk')
  await hide()
  for (const path of ['/api/public/slides', '/@owner']) {
    const response = await get(path)
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).not.toContain('Hidden talk')
    expect(body).toContain('Other talk')
  }
})

test('F17-AC8: Given a public deck, When an operator hides it, Then its cover image is not served', async () => {
  expect((await get(`/covers/${talk}.jpg`)).status).toBe(200)
  await hide()
  expect((await get(`/covers/${talk}.jpg`)).status).toBe(404)
})

/** Source files under `directory`, tests excluded. */
async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory()) return sources(path)
      return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
        ? [path]
        : []
    }),
  )
  return nested.flat()
}

// Files that read the public pointer to decide what the author may do, or
// to store it; they show nothing to readers.
const AUTHOR_SIDE = [
  'src/db/schema.ts',
  'src/decks/deletion-store.ts',
  // The author's own list; it tells them themselves when a deck is hidden.
  'src/decks/own-decks-store.ts',
  'src/decks/own-decks.ts',
  // Whether the author may still change a slide's URL name.
  'src/decks/rename-store.ts',
  'src/publication/state.ts',
  'src/publication/store.ts',
  'src/publication/test-support.ts',
]

test('F17-AC7: Given every source file that reads the public pointer for readers, When it is checked, Then each read is matched by a not-hidden condition', async () => {
  const count = (text: string, pattern: RegExp) =>
    text.match(pattern)?.length ?? 0
  const missing: string[] = []
  for (const path of await sources('src')) {
    if (AUTHOR_SIDE.includes(path)) continue
    const text = await readFile(path, 'utf8')
    const reads = count(text, /public_deployment_id/g)
    // The import is not a condition.
    const conditions =
      count(text, /\bnotHidden(?:Of)?\b/g) -
      count(text, /import \{[^}]*notHidden/g)
    if (reads > conditions) missing.push(`${path}: ${reads} > ${conditions}`)
  }
  expect(missing).toEqual([])
})

test('F19-AC2: Given sources that use notHidden, When their mute conditions are checked, Then only the explicit exceptions omit notMutedBy', async () => {
  const exceptions = [
    'src/articles/embed-store.ts', // An author's own link to a page; the reader's mutes do not apply.
    'src/notifications/store.ts', // Notifications check whether the recipient muted the actor.
    'src/preview/access-store.ts', // Authorizes access to a deck opened directly.
    'src/preview/owner-view-store.ts', // The author's own deck, shown to them.
    'src/publication/store.ts', // Changes the author's own publication.
    'src/publication/takedown-store.ts', // Defines the shared notHidden condition.
  ]
  const withoutMuteCondition = []
  for (const path of await sources('src')) {
    const source = await readFile(path, 'utf8')
    if (/\bnotHidden\b/.test(source) && !/\bnotMutedBy\s*\(/.test(source))
      withoutMuteCondition.push(path)
  }
  expect(withoutMuteCondition.sort()).toEqual(exceptions)
})
