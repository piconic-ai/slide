import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
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
  expect(order).toEqual([
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
  expect(head).toContain('href="/@owner/talk"')
  expect(head).not.toContain('/preview')
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

const receivedAt = (id: string, at: number) =>
  db
    .prepare('UPDATE deployments SET ready_at = ? WHERE id = ?')
    .bind(at, id)
    .run()

const rowsOf = (body: string) =>
  [...body.matchAll(/data-version-row="([a-z]+)"/g)].map((match) => match[1])

test.each(['ja', 'en'] as const)(
  'F02-AC8: Given versions in every state, When the page opens in %s, Then no deployment ID, source, receiving state, file count or start time shows',
  async (lang) => {
    const ready = await seedDeployment(db, 'talk')
    await seedDeployment(db, 'talk', 'uploading')
    await seedDeployment(db, 'talk', 'failed')
    await act({ action: 'publish', deploymentId: ready })
    const body = await page(lang)
    const main = /<main[\s\S]*<\/main>/.exec(body)?.[0] ?? ''
    const visible = main.replace(/<[^>]*>/g, ' ')
    expect(main).not.toContain('<table')
    expect(visible).not.toMatch(
      /deployment|出どころ|Sent from|ブラウザ|AI エージェント|受領|受信中|ファイルの数|\d \/ \d|開始|Started|作者限定/,
    )
    expect(visible).not.toContain(ready)
  },
)

test('F02-AC9: Given each state, When the page opens, Then one status chip shows, whatever the rows say', async () => {
  const id = await seedDeployment(db, 'talk')
  expect((await page()).match(/class="status-chip/g)).toHaveLength(1)
  await act({ action: 'publish', deploymentId: id })
  expect((await page()).match(/class="status-chip/g)).toHaveLength(1)
  await act({ action: 'pause' })
  expect((await page()).match(/class="status-chip/g)).toHaveLength(1)
})

test('F02-AC10: Given a public slide with no newer version, When the page opens, Then the only row is the version readers see', async () => {
  const id = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: id })
  const body = await page()
  expect(rowsOf(body)).toEqual(['visible'])
  expect(body).toContain('読者に見えている版')
  expect(body).toContain('に受け取り')
  expect(body).not.toContain('この版を公開する')
})

test('F02-AC11 to F02-AC14: Given a public slide, When a newer version is received and then published, Then a second row appears with the publish button, the swap happens, and one row remains', async () => {
  const first = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: first })
  await db
    .prepare('UPDATE deployments SET ready_at = 100 WHERE id = ?')
    .bind(first)
    .run()
  const second = await seedDeployment(db, 'talk')
  await db
    .prepare('UPDATE deployments SET ready_at = 200 WHERE id = ?')
    .bind(second)
    .run()
  const body = await page()
  expect(rowsOf(body)).toEqual(['visible', 'newer'])
  expect(body).toContain('まだ公開していない新しい版')
  // F02-AC12: both rows have a date and "見る"; the new one can be published
  expect(body.match(/>\s*見る\s*</g)).toHaveLength(2)
  expect(body.match(/に受け取り/g)).toHaveLength(2)
  expect(body).toContain(`name="deploymentId" value="${second}"`)
  await act({ action: 'publish', deploymentId: second })
  const after = await page()
  expect(rowsOf(after)).toEqual(['visible'])
  expect(after).toContain('href="/@owner/talk"')
  expect(after).not.toContain('?v=')
})

test('F02-AC12: Given publishing is stopped with a newer version received, When the page opens, Then the stopped row offers "もう一度公開する" and the newer one "この版を公開する"', async () => {
  const first = await seedDeployment(db, 'talk')
  await receivedAt(first, 100)
  await act({ action: 'publish', deploymentId: first })
  await act({ action: 'pause' })
  await receivedAt(await seedDeployment(db, 'talk'), 200)
  const body = await page()
  const rows = rowsOf(body)
  expect(rows).toEqual(['stopped', 'newer'])
  expect(body).toContain('公開を止めています')
  expect(body).toMatch(/>\s*もう一度公開する\s*</g)
  expect(body).toContain('この版を公開する')
})

test('F02-AC12: Given a draft, When the page opens, Then its one row says it is not published and can be published', async () => {
  const id = await seedDeployment(db, 'talk')
  const body = await page()
  expect(rowsOf(body)).toEqual(['unpublished'])
  expect(body).toContain('この版を公開する')
  expect(body).toContain(`name="deploymentId" value="${id}"`)
})

test('F02-AC13: Given a new version, When "この版を公開する" is pressed, Then readers get the new version at the same URL', async () => {
  const first = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: first })
  const second = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: second })
  const row = await db
    .prepare("SELECT public_deployment_id AS id FROM decks WHERE id = 'talk'")
    .first<{ id: string }>()
  expect(row?.id).toBe(second)
})

test('F02-AC16: Given an older version and a newer public one, When the page opens, Then there is no way to roll back', async () => {
  const older = await seedDeployment(db, 'talk')
  await receivedAt(older, 10)
  const newer = await seedDeployment(db, 'talk')
  await receivedAt(newer, 20)
  await act({ action: 'publish', deploymentId: newer })
  for (const body of [await page(), await page('en')]) {
    expect(body).not.toContain(`name="deploymentId" value="${older}"`)
    expect(body).not.toMatch(/差し戻|roll ?back/i)
  }
})

test('F02-AC32: Given a received version, When the page opens, Then the title button and the row open the viewer, not the author-only session', async () => {
  const id = await seedDeployment(db, 'talk')
  const body = await page()
  expect(body).toContain('href="/@owner/talk"')
  expect(body).toContain(`href="/@owner/talk?v=${id}"`)
  expect(body).not.toContain('/preview')
})

test('F02-AC40: Given a public version, When the page opens, Then its row opens the viewer as readers see it', async () => {
  const id = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: id })
  const body = await page()
  expect(body.match(/href="\/@owner\/talk"/g)?.length).toBeGreaterThanOrEqual(2)
  expect(body).not.toContain('?v=')
})

test('F02-AC41: Given a public version and a new one, When the page opens, Then the new row opens that version in the viewer', async () => {
  const first = await seedDeployment(db, 'talk')
  await receivedAt(first, 10)
  await act({ action: 'publish', deploymentId: first })
  const second = await seedDeployment(db, 'talk')
  await receivedAt(second, 20)
  const body = await page()
  expect(body).toContain(`href="/@owner/talk?v=${second}"`)
  expect(body).not.toContain(`?v=${first}`)
})

test('F02-AC42: Given a paused slide, When the page opens, Then its row opens that version in the viewer', async () => {
  const id = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: id })
  await act({ action: 'pause' })
  const body = await page()
  expect(body).toContain(`href="/@owner/talk?v=${id}"`)
})

test('Given no content domain, When the page opens, Then no row has "見る"', async () => {
  await seedDeployment(db, 'talk')
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/slides/talk`, { headers: { Cookie: cookie } }),
    { ...env, CONTENT_ORIGIN: '' } as unknown as Env,
  )
  const body = await response.text()
  expect(body).not.toMatch(/>\s*見る\s*</)
  expect(body).not.toContain('/preview')
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

test('F02-AC11: Given X was started before Y but received after it, and Y is public, When the page opens, Then X is the new version', async () => {
  const x = await seedDeployment(db, 'talk')
  const y = await seedDeployment(db, 'talk')
  await db
    .prepare(
      'UPDATE deployments SET created_at = 10, ready_at = 300 WHERE id = ?',
    )
    .bind(x)
    .run()
  await db
    .prepare(
      'UPDATE deployments SET created_at = 20, ready_at = 100 WHERE id = ?',
    )
    .bind(y)
    .run()
  await act({ action: 'publish', deploymentId: y })
  const body = await page()
  expect(rowsOf(body)).toEqual(['visible', 'newer'])
  expect(body).toContain(`name="deploymentId" value="${x}"`)
})

test('F02-AC12: Given a version started on one day and received on the next, When the page opens, Then the row shows the day it was received', async () => {
  const id = await seedDeployment(db, 'talk')
  // 2026-11-19 12:00 UTC started; 2026-11-19 16:00 UTC (20 Nov in Tokyo) received.
  await db
    .prepare('UPDATE deployments SET created_at = ?, ready_at = ? WHERE id = ?')
    .bind(
      Date.UTC(2026, 10, 19, 12) / 1000,
      Date.UTC(2026, 10, 19, 16) / 1000,
      id,
    )
    .run()
  expect(await page()).toContain('2026年11月20日に受け取り')
})
