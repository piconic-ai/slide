import { describe, expect, test } from 'vitest'
import { findArticle } from '../help/catalog'
import { HELP_CATALOG } from '../help/default-catalog'
import { LANGS } from './i18n'
import { settingsBody } from './settings-pages'

type Owner = Parameters<typeof settingsBody>[0]
const owner: Owner = {
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
  dataExport: {
    account: [{ label: 'Account', href: '/account/export/account.json' }],
    slides: [],
    page: 1,
    lastPage: 1,
  },
}

/** The frames of the settings page, by their `id`, each with its markup. */
const frames = async (lang: (typeof LANGS)[number]) => {
  const page = String(
    await settingsBody(owner, lang, new URL('https://slide.example/')),
  )
  return new Map(
    [
      ...page.matchAll(
        /<section class="panel" id="([a-z]+)"[\s\S]*?<\/section>/g,
      ),
    ].map((match) => [match[1]!, match[0]] as const),
  )
}

/** Which article each frame leads to; a frame not here has no article. */
const EXPECTED: Readonly<Record<string, string>> = {
  profile: '/help/account/edit-profile',
  account: '/help/account/change-email',
  export: '/help/agent/export-with-agent',
  agents: '/help/agent/connect',
  communities: '/help/community/community-admins',
  blocks: '/help/safety/block-vs-mute',
  mutes: '/help/safety/block-vs-mute',
  leave: '/help/account/before-leaving',
}

describe('the settings page leads each frame to its article', () => {
  test.each(LANGS)(
    'F36-AC41, F36-AC40, F36-AC45: Given the settings in %s, When each frame is read, Then it has one link to its article, an article that exists',
    async (lang) => {
      const found = await frames(lang)
      for (const [id, path] of Object.entries(EXPECTED)) {
        const frame = found.get(id)
        expect(frame, id).toBeDefined()
        const hrefs = [...frame!.matchAll(/href="(\/help[^"]*)"/g)].map(
          (match) => match[1],
        )
        expect(hrefs, id).toEqual([path])
        const [, , aim, slug] = path.split('/')
        expect(findArticle(HELP_CATALOG, aim!, slug!), id).not.toBeNull()
      }
    },
  )

  test('F36-AC41: Given the frames that have no article, When the settings are read, Then they hold no link to the help', async () => {
    const found = await frames('ja')
    for (const id of ['notifications', 'language'])
      expect(found.get(id)?.includes('/help'), id).toBe(false)
  })

  test('F36-AC40: Given the place for exporting data, When it is read, Then “Export with an AI agent” leads to the article on it', async () => {
    const ja = (await frames('ja')).get('export')!
    expect(ja).toContain(
      '<a class="export-help" href="/help/agent/export-with-agent"',
    )
    const en = (await frames('en')).get('export')!
    expect(en).toContain('Export with an AI agent')
  })

  test('F36-AC45: Given the frame for leaving, When it is read, Then the link sits under the heading, before the confirmation field', async () => {
    const leave = (await frames('ja')).get('leave')!
    expect(leave.indexOf('/help/account/before-leaving')).toBeGreaterThan(
      leave.indexOf('<h2>'),
    )
    expect(leave.indexOf('/help/account/before-leaving')).toBeLessThan(
      leave.indexOf('leave-confirm'),
    )
  })
})
