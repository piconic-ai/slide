import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedDeck,
  seedDeployment,
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

let cookie = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
  cookie = await signIn(env)
})
afterAll(() => platform.dispose())

const page = async (lang = 'ja') => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/slides/talk?lang=${lang}`, {
      headers: { Cookie: cookie },
    }),
    env,
  )
  expect(response.status).toBe(200)
  return (await response.text()).replace(/\s+/g, ' ')
}
const frameOf = (body: string, name: string) =>
  new RegExp(
    `<section[^>]*data-deck-frame="${name}"[^>]*>(.*?)</section>`,
  ).exec(body)?.[1] ?? ''

let revision = 0
async function act(fields: Record<string, string>) {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/slides/talk/publication`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        ...fields,
        expectedRevision: String(revision),
      }).toString(),
    }),
    env,
  )
  expect(response.status).toBe(303)
  revision++
}
beforeEach(() => {
  revision = 0
})

test('F03-AC39: Given a slide with a received version, When its page opens, Then the frames come in the order title, publication, share URL, new version, deletion', async () => {
  await seedDeployment(db, 'talk')
  const body = await page()
  const order = [...body.matchAll(/data-deck-frame="([a-z-]+)"/g)].map(
    (match) => match[1],
  )
  expect(order.filter((name) => name !== 'history')).toEqual([
    'title',
    'publication',
    'share-url',
    'replace',
    'delete',
  ])
  expect(body.indexOf('<h1')).toBeLessThan(
    body.indexOf('data-deck-frame="publication"'),
  )
})

test('F03-AC41: Given a received version, When the page opens, Then it has no preview of the slides and "viewer で見る" sits beside the title', async () => {
  const id = await seedDeployment(db, 'talk')
  const body = await page()
  expect(body).not.toContain('data-deck-frame="preview"')
  expect(body).not.toContain('data-cover')
  const head = /<div class="deck-head"[^>]*>(.*?)<\/form>/.exec(body)?.[1] ?? ''
  expect(head).toContain(`/slides/talk/deployments/${id}/preview`)
  expect(head).toContain('viewer で見る')
  expect(await page('en')).toContain('View in viewer')
})

test.each([
  ['draft', 'まだ公開していません', 'Not published yet'],
  ['public', '公開中', 'Public'],
  ['paused', '公開を止めています', 'Publishing is stopped'],
] as const)(
  'F02-AC9: Given a %s slide, When the page opens in either language, Then the publication frame says so in one sentence',
  async (kind, ja, en) => {
    const id = await seedDeployment(db, 'talk')
    if (kind !== 'draft') await act({ action: 'publish', deploymentId: id })
    if (kind === 'paused') await act({ action: 'pause' })
    expect(frameOf(await page(), 'publication')).toContain(`>${ja}</span>`)
    expect(frameOf(await page('en'), 'publication')).toContain(`>${en}</span>`)
  },
)

test.each(['ja', 'en'] as const)(
  'F02-AC15: Given a public slide, When the page opens in %s, Then the note on stopping says readers lose it and publishing again restores the URL, without cookie or session',
  async (lang) => {
    const id = await seedDeployment(db, 'talk')
    await act({ action: 'publish', deploymentId: id })
    const note = /id="pause-note">(.*?)<\/p>/.exec(await page(lang))?.[1] ?? ''
    expect(note).toBe(
      lang === 'ja'
        ? '止めると、読者は開けなくなります。もう一度公開すると、同じ URL で開けます。'
        : 'Readers will no longer be able to open them. Publish again and they open at the same URL.',
    )
    expect(note).not.toMatch(/cookie|session|セッション/i)
  },
)

test('F02-AC9 and F02-AC8: Given a draft with a received version, When the page opens, Then the publication frame offers "公開する" for that version and names no deployment', async () => {
  const id = await seedDeployment(db, 'talk')
  const frame = frameOf(await page(), 'publication')
  expect(frame).toContain(`name="deploymentId" value="${id}"`)
  expect(frame).toMatch(/>\s*公開する\s*</)
  expect(frame.replace(/<[^>]*>/g, ' ')).not.toMatch(/deployment/i)
})

test('F02-AC9: Given a draft with nothing received, When the page opens, Then there is no publish button, only a line that says to drop slides', async () => {
  const frame = frameOf(await page(), 'publication')
  expect(frame).not.toContain('<button')
  expect(frame).toContain('スライドを置くと、公開できます。')
})

test('F22-AC32: Given a slide never published, When the page opens, Then the URL name is an input; Given it was published, Then it is text with no input', async () => {
  const id = await seedDeployment(db, 'talk')
  const draft = frameOf(await page(), 'share-url')
  expect(draft).toContain('<input class="text-input" id="url-name"')
  await act({ action: 'publish', deploymentId: id })
  const published = frameOf(await page(), 'share-url')
  expect(published).not.toContain('id="url-name"><')
  expect(published).not.toMatch(/<input[^>]*name="slug"/)
  expect(published).toContain('<strong>talk</strong>')
})

test('F25-AC11: Given a draft and a public slide, When the page opens, Then it has no embed code frame', async () => {
  const id = await seedDeployment(db, 'talk')
  for (const body of [await page(), await page('en')]) {
    expect(body).not.toContain('embed-code')
    expect(body).not.toContain('埋め込みコード')
  }
  await act({ action: 'publish', deploymentId: id })
  const body = await page()
  expect(body).not.toContain('embed-code')
  expect(body).not.toContain('埋め込みコード')
})

test.each(['ja', 'en'] as const)(
  'F02-AC9: Given an operator hid public slides, When the page opens in %s, Then the frame says they are hidden, not "public", and offers no button that would be refused',
  async (lang) => {
    const id = await seedDeployment(db, 'talk')
    await act({ action: 'publish', deploymentId: id })
    await db
      .prepare(
        "UPDATE decks SET hidden_at = 5, hidden_reason = 'spam', hidden_by = 'op' WHERE id = 'talk'",
      )
      .run()
    const frame = frameOf(await page(lang), 'publication')
    expect(frame).toContain(
      lang === 'ja'
        ? '運営がこのスライドを非表示にしています。'
        : 'The operator has hidden these slides.',
    )
    expect(frame).not.toContain('status-chip status-public')
    expect(frame).not.toContain('<form')
    expect(frame).not.toContain('<button')
  },
)
