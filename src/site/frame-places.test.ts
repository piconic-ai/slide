import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

// Each frame of the works to come stands in as a marker, so that where the
// pages put it can be seen while it still holds nothing. The mocks are
// hoisted above the imports, so the markers are made by a hoisted helper.
const marker = (name: string) => `<i data-frame-place="${name}"></i>`
const { mark } = vi.hoisted(() => ({
  mark: async (name: string) => {
    const { raw } = await import('hono/html')
    return raw(`<i data-frame-place="${name}"></i>`)
  },
}))
vi.mock('../share/viewer-events-frame', async () => {
  const events = await mark('viewer-events')
  return { viewerEventsFrame: () => events }
})
vi.mock('../share/viewer-recommendations-frame', async () => {
  const [event, community] = [
    await mark('same-event'),
    await mark('same-community'),
  ]
  return {
    viewerSameEventFrame: () => event,
    viewerSameCommunityFrame: () => community,
  }
})
vi.mock('./settings-blocks-frame', async () => {
  const frame = await mark('settings-blocks')
  return { settingsBlocksFrame: () => frame }
})
vi.mock('../decks/events-frame', async () => {
  const frame = await mark('presented-events')
  return { presentedEventsFrame: () => frame }
})

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const env = testEnv(platform.env)
let alice = ''

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  alice = await signIn(env, 'alice')
  await seedPublic(database, 'keynote', 1, 'Alice’s keynote')
})
afterAll(() => platform.dispose())

const get = async (path: string, cookie = '') => {
  const response = await server.fetch(
    new Request(new URL(path, TEST_ORIGIN), {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
  )
  expect(response.status).toBe(200)
  return response.text()
}

/** Where each of `marks` is in `page`, failing for one that is missing. */
const at = (page: string, ...marks: string[]) =>
  marks.map((mark) => {
    const index = page.indexOf(mark)
    expect(index, mark).toBeGreaterThan(-1)
    return index
  })

const inOrder = (page: string, ...marks: string[]) => {
  const found = at(page, ...marks)
  expect([...found].sort((a, b) => a - b)).toEqual(found)
}

test('Given the viewer, When it is drawn, Then the events stand under the title and the two sections of other talks under everything else, in that order', async () => {
  const page = await get('/@alice/keynote')
  inOrder(
    page,
    '<h1>Alice’s keynote</h1>',
    marker('viewer-events'),
    'data-viewer-side',
    marker('same-event'),
    marker('same-community'),
    '</main>',
  )
})

test('Given the settings, When they are drawn, Then the people blocked come right after the agents, before the people muted', async () => {
  const page = await get('/settings', alice)
  inOrder(
    page,
    'data-settings-frame="agents"',
    marker('settings-blocks'),
    'id="mutes"',
    'id="notifications"',
  )
})

test('Given the page of one slide, When it is drawn, Then the events presented at stand right under the related links', async () => {
  const page = await get('/my/slides/keynote', alice)
  inOrder(
    page,
    'data-deck-frame="links"',
    marker('presented-events'),
    'data-deck-frame="replace"',
  )
})
