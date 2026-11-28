import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import {
  resetCommunities,
  seedCommunity,
  seedTalkLink,
} from '../communities/test-communities'
import { applyMigrations } from '../db/test-migrations'
import {
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
} as unknown as Env

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetCommunities(db)
  // Signing in records the handle `owner` that share URLs carry.
  await signIn(env)
  await seedPublic(db, 'talk', 100, 'Talk')
})
afterAll(() => platform.dispose())

const viewer = async () =>
  (
    await (
      await server.fetch(new Request(`${TEST_ORIGIN}/@owner/talk`), env)
    ).text()
  )
    .replace(/\s+/g, ' ')
    .replace(/ >/g, '>')
    .replace(/ </g, '<')

test('F24-AC51: Given a slide whose related link is an event of a community, When its viewer opens, Then under the title stand the logo, the event, “で発表” and the community', async () => {
  await seedCommunity(db, {
    id: 77,
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: ['https://kanagawapm.connpass.com/'],
  })
  await seedTalkLink(db, {
    deckId: 'talk',
    url: 'https://kanagawapm.connpass.com/event/410635/',
    title: 'Kanagawa.pm #3',
  })
  const page = await viewer()
  const title = page.indexOf('<h1>Talk</h1>')
  const row = page.indexOf('<ul class="viewer-events"')
  expect(title).toBeGreaterThan(0)
  expect(row).toBeGreaterThan(title)
  const line = page.slice(row, page.indexOf('</ul>', row))
  expect(line).toContain('community-logo-28')
  expect(line).toMatch(
    /<a class="viewer-event-name" href="\/link\/connpass\.com\/event\/\d+">Kanagawa\.pm #3<\/a><span>で発表<\/span>/,
  )
  expect(line).toContain('<a href="/@kanagawapm">Kanagawa.pm</a>')
})

test('F24-AC51: Given a slide whose event is in no community, When its viewer opens, Then its line has no logo and no community', async () => {
  await seedTalkLink(db, {
    deckId: 'talk',
    url: 'https://connpass.com/event/410635/',
    title: 'Groupless',
  })
  const page = await viewer()
  const row = page.indexOf('<ul class="viewer-events"')
  const line = page.slice(row, page.indexOf('</ul>', row))
  expect(line).toContain('>Groupless</a><span>で発表</span>')
  expect(line).not.toContain('community-logo')
  expect(line).not.toContain('href="/@')
})

test('F24-AC40: Given a slide in two events, When its viewer opens, Then their lines come in the order their links were added', async () => {
  await seedTalkLink(db, {
    deckId: 'talk',
    url: 'https://perl.connpass.com/event/2/',
    title: 'Second added first',
  })
  await seedTalkLink(db, {
    deckId: 'talk',
    url: 'https://perl.connpass.com/event/1/',
    title: 'First added second',
  })
  const page = await viewer()
  expect(page.match(/<li class="viewer-event">/g)).toHaveLength(2)
  expect(page.indexOf('Second added first</a><span>で発表')).toBeLessThan(
    page.indexOf('First added second</a><span>で発表'),
  )
})

test('F24-AC51: Given a slide with no event, When its viewer opens, Then no event line shows', async () => {
  expect(await viewer()).not.toContain('<ul class="viewer-events"')
})
