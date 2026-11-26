import { expect, test } from 'vitest'
import { deckPageBody, type DeckPageView } from '../decks/deck-page'
import type { DeckSlug } from '../decks/deck-id'
import type { Handle } from '../share/handle'
import { settingsBody } from './settings-pages'

const links = [{ label: 'Published version (zip)', href: '/slides/talk/zip' }]

type Owner = Parameters<typeof settingsBody>[0]
const owner = (patch: Partial<Owner> = {}): Owner => ({
  login: 'owner',
  handle: 'owner',
  email: 'owner@example.com',
  devices: [],
  deviceNotice: 'none',
  profileForm: {
    fields: {
      name: '',
      bio: '',
      location: '',
      website: '',
      links: [],
      useGravatar: true,
    },
    problems: [],
    saved: false,
    picture: { src: '/face', uploaded: false, result: { kind: 'none' } },
  },
  blocked: [],
  managed: [],
  muted: [],
  optOuts: [],
  agents: { mcpUrl: 'https://slide.example/mcp', connections: [] },
  ...patch,
})
const settings = async (patch: Partial<Owner>, lang: 'ja' | 'en' = 'ja') =>
  String(
    await settingsBody(owner(patch), lang, new URL('https://slide.example/')),
  )

test('Given nothing to export, When settings are drawn, Then no export place appears', async () => {
  const page = await settings({})
  expect(page).not.toContain('id="export"')
  expect(page).not.toContain('データを書き出す')
})

test('Given links to export, When settings are drawn, Then the place sits under the account and above leaving', async () => {
  const page = await settings({ dataExport: links })
  const account = page.indexOf('id="account"')
  const exported = page.indexOf('id="export"')
  const leave = page.indexOf('id="leave"')
  expect(account).toBeGreaterThan(0)
  expect(exported).toBeGreaterThan(account)
  expect(leave).toBeGreaterThan(exported)
  expect(page.match(/id="export"/g)).toHaveLength(1)
})

const deck = (patch: Partial<DeckPageView> = {}): DeckPageView => ({
  slug: 'talk' as DeckSlug,
  handle: 'owner' as Handle,
  name: 'Talk',
  shareUrl: null,
  urlName: { renamable: true, notice: null },
  publication: {
    state: { publication: { kind: 'draft' }, revision: 0 },
    takedown: null,
    pointed: null,
    latest: null,
    result: null,
    delivery: true,
  },
  links: { list: [], notice: null },
  events: [],
  article: null,
  ...patch,
})
const slide = async (patch: Partial<DeckPageView>) =>
  String(await deckPageBody(deck(patch), 'ja'))

test('Given nothing to download, When the slide page is drawn, Then no download place appears', async () => {
  expect(await slide({})).not.toContain('data-deck-frame="downloads"')
})

test('Given links to download, When the slide page is drawn, Then the place sits below the publication and above deletion', async () => {
  const page = await slide({ downloads: links })
  const publication = page.indexOf('data-deck-frame="publication"')
  const downloads = page.indexOf('data-deck-frame="downloads"')
  const deletion = page.indexOf('data-deck-frame="delete"')
  expect(downloads).toBeGreaterThan(0)
  expect(deletion).toBeGreaterThan(downloads)
  expect(downloads).toBeGreaterThan(publication)
  expect(page.match(/data-deck-frame="downloads"/g)).toHaveLength(1)
})
