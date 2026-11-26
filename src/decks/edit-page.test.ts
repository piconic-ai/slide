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
    new Request(`${TEST_ORIGIN}/my/slides/talk?lang=${lang}`, {
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
    new Request(`${TEST_ORIGIN}/my/slides/talk/publication`, {
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

test('F03-AC156 and F02-AC55: Given a slide with a received version, When its page opens, Then the frames come in the order title, slides, share URL, article, related links, events presented at, deletion, with no publication or new-version frame', async () => {
  await seedDeployment(db, 'talk')
  const body = await page()
  const order = [...body.matchAll(/data-deck-frame="([a-z-]+)"/g)].map(
    (match) => match[1],
  )
  expect(order).toEqual([
    'title',
    'slide',
    'share-url',
    'article',
    'links',
    'events',
    'delete',
  ])
  expect(frameOf(body, 'slide')).toMatch(/<h2[^>]*>スライド<\/h2>/)
  expect(frameOf(await page('en'), 'slide')).toMatch(/<h2[^>]*>Slides<\/h2>/)
  expect(body).not.toMatch(/<h2[^>]*>(公開|新しい版)<\/h2>/)
})

test('F03-AC157 and F02-AC64: Given a received version, When the page opens in either language, Then it has no preview of the slides and no viewer button by the title', async () => {
  await seedDeployment(db, 'talk')
  for (const body of [await page(), await page('en')]) {
    expect(body).not.toContain('data-deck-frame="preview"')
    expect(body).not.toContain('data-cover')
    const head =
      /<div class="deck-head"[^>]*>(.*?)<\/div>/.exec(body)?.[1] ?? ''
    expect(head).toContain('<h1')
    expect(head).not.toContain('<a')
    expect(body).not.toContain('ビューアーで見る')
    expect(body).not.toContain('View in viewer')
  }
})

const firstRowOf = (body: string) =>
  /<li class="version-row"[^>]*>(.*?)<\/li>/.exec(
    frameOf(body, 'slide'),
  )?.[1] ?? ''

test.each([
  ['draft', 'まだ公開していません', 'Not published yet'],
  ['public', '公開中', 'Public'],
  ['paused', '公開を止めています', 'Publishing is stopped'],
] as const)(
  'F02-AC58: Given a %s slide, When the page opens in either language, Then the first version row has the state tag beside the version name',
  async (kind, ja, en) => {
    const id = await seedDeployment(db, 'talk')
    if (kind !== 'draft') await act({ action: 'publish', deploymentId: id })
    if (kind === 'paused') await act({ action: 'pause' })
    const tag = (text: string) =>
      new RegExp(
        `<span class="version-row-kind">[^<]*</span>\\s*<span class="status-chip status-${kind}"\\s*>\\s*${text}\\s*</span\\s*>`,
      )
    expect(firstRowOf(await page())).toMatch(tag(ja))
    expect(firstRowOf(await page('en'))).toMatch(tag(en))
  },
)

test.each([
  ['draft', 'まだ公開していない版', '公開する'],
  ['public', '読者に見えている版', '公開を止める'],
  ['paused', '止める前に見えていた版', 'もう一度公開する'],
] as const)(
  'F02-AC59 and F02-AC60: Given a %s slide, When the page opens, Then the first row is named for it, ends with the one button that changes where publication stands, and has no sentence about what readers can do',
  async (kind, name, button) => {
    const id = await seedDeployment(db, 'talk')
    if (kind !== 'draft') await act({ action: 'publish', deploymentId: id })
    if (kind === 'paused') await act({ action: 'pause' })
    const row = firstRowOf(await page())
    expect(row).toMatch(
      new RegExp(`<span class="version-row-kind">${name}</span>`),
    )
    expect(row.match(/<button/g)).toHaveLength(1)
    expect(row).toMatch(
      new RegExp(`>\\s*${button}\\s*</button>\\s*</form>\\s*$`),
    )
    const frame = frameOf(await page(), 'slide')
    for (const gone of [
      '読者が開けます',
      '読者は開けません',
      'いまはあなただけが見られます',
      '止めると、読者は開けなくなります',
      'pause-note',
    ])
      expect(frame).not.toContain(gone)
  },
)

test('F02-AC59 and F02-AC60: Given publishing was stopped before anything was public, When the page opens, Then the first row is the newest version, not yet published, with "公開する" under the stopped tag', async () => {
  const id = await seedDeployment(db, 'talk')
  await act({ action: 'pause' })
  const row = firstRowOf(await page())
  expect(row).toContain('まだ公開していない版')
  expect(row).toContain('status-chip status-paused')
  expect(row).toMatch(/>\s*公開する\s*<\/button>/)
  expect(row).toContain(`name="deploymentId" value="${id}"`)
})

test('F02-AC61: Given each state with a newer version, When the page opens, Then no version is offered by two publish buttons', async () => {
  const first = await seedDeployment(db, 'talk')
  await receivedAt(first, 100)
  const second = await seedDeployment(db, 'talk')
  await receivedAt(second, 200)
  const offered = async () =>
    [...(await page()).matchAll(/name="deploymentId" value="([^"]+)"/g)].map(
      (match) => match[1],
    )
  const once = (ids: readonly (string | undefined)[]) =>
    expect(new Set(ids).size).toBe(ids.length)
  once(await offered())
  await act({ action: 'publish', deploymentId: first })
  once(await offered())
  await act({ action: 'pause' })
  const paused = await page()
  once(await offered())
  // Publishing again is its own button; the stopped version has no publish form.
  expect(paused.match(/value="resume"/g)).toHaveLength(1)
  expect(paused).not.toContain(`name="deploymentId" value="${first}"`)
})

test.each(['ja', 'en'] as const)(
  'F02-AC51: Given the help in %s, When it is read, Then it says that stopping takes the slides away from readers and that publishing again opens them at the same URL, without cookie or session',
  async (lang) => {
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}/help?lang=${lang}`),
      env,
    )
    const body = (await response.text())
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
    expect(body).toContain(
      lang === 'ja'
        ? '止めると、読者は開けなくなります。もう一度公開すると、同じ URL で開けます。'
        : 'Readers can no longer open the slides; publish again and they open at the same URL.',
    )
  },
)

test('F02-AC59 and F02-AC8: Given a draft with a received version, When the page opens, Then the slide frame offers "公開する" for that version and names no deployment', async () => {
  const id = await seedDeployment(db, 'talk')
  const frame = frameOf(await page(), 'slide')
  expect(frame).toContain(`name="deploymentId" value="${id}"`)
  expect(frame).toMatch(/>\s*公開する\s*</)
  expect(frame.replace(/<[^>]*>/g, ' ')).not.toMatch(/deployment/i)
})

test.each(['ja', 'en'] as const)(
  'F02-AC67 and F02-AC63: Given a draft with nothing received, When the page opens in %s, Then there are no rows, no tag and no button to publish, only the large drop zone',
  async (lang) => {
    const frame = frameOf(await page(lang), 'slide')
    expect(frame).not.toContain('version-row')
    expect(frame).not.toContain('status-chip')
    expect(frame).not.toContain('<form')
    expect(frame).toContain('class="drop-zone drop-zone-first"')
    expect(frame).toContain(
      lang === 'ja' ? 'スライドをドロップ' : 'Drop your slides',
    )
  },
)

test('F02-AC66: Given a received version, When the page opens, Then the drop zone is the low one, after the rows', async () => {
  await seedDeployment(db, 'talk')
  const frame = frameOf(await page(), 'slide')
  expect(frame).toContain('class="drop-zone drop-zone-low"')
  expect(frame.indexOf('version-rows')).toBeLessThan(
    frame.indexOf('drop-zone-low'),
  )
})

test.each(['ja', 'en'] as const)(
  'F22-AC46: Given a slide never published, When the page opens in %s, Then the frame is one small row with the link that opens the field for the end of the URL, and shows no URL and no copy button',
  async (lang) => {
    await seedDeployment(db, 'talk')
    const frame = frameOf(await page(lang), 'share-url')
    expect(frame).not.toContain('id="share-url"')
    expect(frame).not.toContain('data-copy')
    expect(frame).not.toContain('http://')
    expect(frame).toMatch(
      /<details class="url-change"\s*>\s*<summary>\s*(URL を変える|Change the URL)\s*<\/summary>/,
    )
    expect(frame).not.toMatch(/<details[^>]*\sopen/)
    expect(frame).toMatch(/<label for="url-name">URL<\/label>/)
    expect(frame).toMatch(
      /<div class="prefixed-field">\s*<span aria-hidden="true">slide\.example\/@owner\/<\/span>\s*<input\s+id="url-name"[^>]*value="talk"/,
    )
    expect(frame).toContain(
      lang === 'ja' ? '末尾だけ変えられます。' : 'Only the end can be changed',
    )
    expect(frame.replace(/<[^>]*>/g, ' ')).not.toMatch(
      /URL の名前|Name in the URL|slug|共有 URL|Share link/i,
    )
  },
)

test('F22-AC46: Given a slide that was published, When the page opens, Then there is no URL frame at all, and the viewer link is still there', async () => {
  const id = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: id })
  const body = await page()
  expect(body).not.toContain('data-deck-frame="share-url"')
  expect(body).not.toContain('url-name')
  expect(body).not.toContain('id="share-url"')
  expect(body).toContain('href="/@owner/talk"')
})

test('F22-AC45: Given a slide, When the page opens in either language, Then the delete confirmation is one label naming the end of the URL, with no note under it', async () => {
  await seedDeployment(db, 'talk')
  for (const [lang, label] of [
    ['ja', '確認のため、URL の末尾(<code>talk</code>)を入力してください'],
    ['en', 'To confirm, type the end of the URL (<code>talk</code>)'],
  ] as const) {
    const frame = frameOf(await page(lang), 'delete')
    expect(frame).toContain(label)
    expect(frame).not.toContain('delete-confirm-note')
    expect(frame).not.toMatch(/URL の名前|name in the URL/i)
  }
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

test('F02-AC56: Given an outcome to report, When the page opens, Then the notice comes before the rows, and the rows before the drop zone', async () => {
  const id = await seedDeployment(db, 'talk')
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/my/slides/talk?result=applied`, {
      headers: { Cookie: cookie },
    }),
    { ...env, CONTENT_ORIGIN: '' } as unknown as Env,
  )
  const frame = frameOf((await response.text()).replace(/\s+/g, ' '), 'slide')
  const at = (needle: string) => frame.indexOf(needle)
  expect(at('notice-success')).toBeGreaterThan(-1)
  expect(at('notice-success')).toBeLessThan(at('notice-warning'))
  expect(at('notice-warning')).toBeLessThan(at('version-rows'))
  expect(at('version-rows')).toBeLessThan(at('data-drop-zone'))
  expect(frame).toContain(`value="${id}"`)
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

test('F02-AC63: Given each state, When the page opens, Then one status chip shows, on the first version row', async () => {
  const id = await seedDeployment(db, 'talk')
  expect((await page()).match(/class="status-chip/g)).toHaveLength(1)
  await act({ action: 'publish', deploymentId: id })
  expect((await page()).match(/class="status-chip/g)).toHaveLength(1)
  await act({ action: 'pause' })
  expect((await page()).match(/class="status-chip/g)).toHaveLength(1)
  expect(firstRowOf(await page())).toContain('class="status-chip')
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
  expect(body).toContain('止める前に見えていた版')
  expect(body).toMatch(/>\s*もう一度公開する\s*</g)
  expect(body).toContain('この版を公開する')
})

test('F02-AC12: Given a draft, When the page opens, Then its one row says it is not published and can be published', async () => {
  const id = await seedDeployment(db, 'talk')
  const body = await page()
  expect(rowsOf(body)).toEqual(['unpublished'])
  expect(body).toMatch(/>\s*公開する\s*<\/button>/)
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

test('F02-AC42 and F02-AC64: Given a received version, When the page opens, Then only the row opens the viewer, not the author-only session', async () => {
  const id = await seedDeployment(db, 'talk')
  const body = await page()
  expect(body.match(/href="\/@owner\/talk[?"]/g)).toHaveLength(1)
  expect(body).toContain(`href="/@owner/talk?v=${id}"`)
  expect(body).not.toContain('/preview')
})

test('F02-AC40: Given a public version, When the page opens, Then its row opens the viewer as readers see it', async () => {
  const id = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: id })
  const body = await page()
  expect(body.match(/href="\/@owner\/talk"/g)).toHaveLength(1)
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
    new Request(`${TEST_ORIGIN}/my/slides/talk`, {
      headers: { Cookie: cookie },
    }),
    { ...env, CONTENT_ORIGIN: '' } as unknown as Env,
  )
  const body = await response.text()
  expect(body).not.toMatch(/>\s*見る\s*</)
  expect(body).not.toContain('/preview')
})

test.each(['ja', 'en'] as const)(
  'F02-AC68: Given an operator hid public slides, When the page opens in %s, Then the frame says they are hidden, shows no rows and no tag, and offers no button that would be refused, only the drop zone',
  async (lang) => {
    const id = await seedDeployment(db, 'talk')
    await act({ action: 'publish', deploymentId: id })
    await db
      .prepare(
        "UPDATE decks SET hidden_at = 5, hidden_reason = 'spam', hidden_by = 'op' WHERE id = 'talk'",
      )
      .run()
    const frame = frameOf(await page(lang), 'slide')
    expect(frame).toContain(
      lang === 'ja'
        ? '運営がこのスライドを非表示にしています。'
        : 'The operator has hidden these slides.',
    )
    // The notice's own title is styled as a chip; no publication tag shows.
    expect(frame).not.toMatch(/status-chip status-(draft|public|paused)/)
    expect(frame).not.toContain('version-row')
    expect(frame).not.toContain('<form')
    expect(frame).toContain('class="drop-zone drop-zone-low"')
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
