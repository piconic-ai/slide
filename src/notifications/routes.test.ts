import { drizzle } from 'drizzle-orm/d1'
import { decodeHTML } from 'entities'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import {
  citations,
  notificationOptOuts,
  notifications,
  suspensions,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { applyAuthorCommand } from '../publication/author'
import {
  INVITED_ID,
  OWNER_ID,
  seedDeck,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'
import { dayFormats } from '../share/dates'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = withInvited(testEnv(platform.env))
const title = '<script>example</script>'
const original = 'first-talk'
const response = 'in-response'
const citedAt = 86400
const joinedAt = 0

let alice = ''
let bob = ''

beforeAll(async () => {
  await applyMigrations(database)
  alice = await signIn(env, 'alice')
  bob = await signIn(env, 'bob', { id: INVITED_ID })
  expect(alice).not.toBe('')
  expect(bob).not.toBe('')
  await seedPublic(database, original, 1, 'Original')
  await seedPublic(database, response, 2, title, INVITED_ID)
})
beforeEach(async () => {
  await db.batch([
    db.delete(notifications),
    db.delete(notificationOptOuts),
    db.delete(suspensions),
  ])
})
afterAll(() => platform.dispose())

const get = (path: string, cookie = alice) =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), { headers: { Cookie: cookie } }),
    env,
  )

async function pageAt(path: string, cookie = alice) {
  const result = await get(path, cookie)
  expect(result.status).toBe(200)
  expect(result.headers.get('Cache-Control')).toContain('no-store')
  return result.text()
}

const postPreference = (
  fields: Record<string, string>,
  cookie = alice,
  origin = TEST_ORIGIN,
) =>
  server.fetch(
    new Request(new URL('/notifications/preferences', TEST_ORIGIN), {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin },
      body: new URLSearchParams(fields),
    }),
    env,
  )

function expectRedirect(result: Response, path: string) {
  expect(result.status).toBe(303)
  expect(result.headers.get('Location')).toBe(path)
}

// Join delivery belongs to the GitHub sign-in flow. A persisted event is
// enough to exercise the list and count through the real management routes.
const joined = (
  recipient = OWNER_ID,
  actor = INVITED_ID,
  readAt: number | null = null,
) =>
  db.insert(notifications).values({
    id: `joined-${recipient}`,
    kind: 'github_followee_joined',
    recipient_user_id: recipient,
    actor_user_id: actor,
    created_at: joinedAt,
    read_at: readAt,
  })

const cited = (source = response, target = original) =>
  db.insert(notifications).values({
    id: 'citation',
    kind: 'cited',
    recipient_user_id: OWNER_ID,
    actor_user_id: INVITED_ID,
    deck_id: source,
    target_deck_id: target,
    created_at: citedAt,
  })

/**
 * How many notifications the header's bell tells a visitor of. The count
 * left the list of slides for the bell, which every page draws from the
 * session.
 */
async function bellCount(cookie = alice) {
  const result = await get('/api/session', cookie)
  expect(result.status).toBe(200)
  expect(result.headers.get('Cache-Control')).toContain('no-store')
  return ((await result.json()) as { unread?: number }).unread
}

function linkLabel(page: string, href: string) {
  const link = [
    ...page.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a\s*>/g),
  ].find(([, path]) => path === href)
  expect(link, href).toBeDefined()
  return decodeHTML((link?.[2] ?? '').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

const locales = [
  {
    lang: 'ja',
    heading: 'お知らせ',
    empty: 'お知らせはありません。',
    cited: `@bob さんのスライド「${title}」が、あなたのスライド「Original」を引用しました`,
    joined: 'GitHub でフォローしている @bob さんが、Slide を使い始めました',
    published: `@bob さんが、スライド「${title}」を公開しました`,
    followed: '@bob さんに、フォローされました',
    choose: '受け取るお知らせを選ぶ',
    fresh: '新着',
  },
  {
    lang: 'en',
    heading: 'Notifications',
    empty: 'No notifications.',
    cited: `@bob's slides “${title}” cite your slides “Original”`,
    joined: '@bob, whom you follow on GitHub, started using Slide',
    published: `@bob published “${title}”`,
    followed: '@bob followed you',
    choose: 'Choose what you receive',
    fresh: 'New',
  },
] as const

test.each(locales)(
  'F20-AC1: Given a citation and an older join, When Alice opens the $lang list, Then each dated item links to its deck or profile in newest-first order',
  async (t) => {
    await joined()
    await cited()
    const page = await pageAt(`/notifications?lang=${t.lang}`)
    expect(page).toContain(`<h1>${t.heading}</h1>`)
    const rows = [...page.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/g)].map(
      ([row]) => row,
    )
    const citation = rows.findIndex((row) =>
      row.includes(`href="/@bob/${response}"`),
    )
    const join = rows.findIndex((row) => row.includes('href="/@bob"'))
    expect(citation).toBeGreaterThanOrEqual(0)
    expect(join).toBeGreaterThan(citation)
    const days = dayFormats[t.lang]
    for (const row of rows) expect(row.match(/<a\b/g)).toHaveLength(1)
    expect(linkLabel(rows[citation], `/@bob/${response}`)).toBe(
      `${t.cited} ${days.format(citedAt * 1000)} ${t.fresh}`,
    )
    expect(linkLabel(rows[join], '/@bob')).toBe(
      `${t.joined} ${days.format(joinedAt * 1000)} ${t.fresh}`,
    )
    expect(page).not.toContain(title)
    expect(rows[citation]).toContain('&lt;script&gt;example&lt;/script&gt;')
    expect(linkLabel(page, '/settings#notifications')).toBe(t.choose)
  },
)

test.each(locales)(
  'F20-AC12: Given a notification and the empty state, When Alice opens the $lang list, Then the page has no link back to the slide management and keeps the preferences link',
  async (t) => {
    await joined()
    const main = (html: string) => /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? ''
    const full = main(await pageAt(`/notifications?lang=${t.lang}`))
    expect(full).toContain('href="/settings#notifications"')
    expect(full).not.toContain('href="/slides"')
    expect(full).not.toMatch(/スライドの管理に戻る|Back to your slides/)
    await db.delete(notifications)
    const empty = main(await pageAt(`/notifications?lang=${t.lang}`))
    expect(empty).toContain(t.empty)
    expect(empty).not.toContain('href="/slides"')
  },
)

test.each(locales)(
  'Given a followed author published a deck and also followed Alice, When she opens the $lang list, Then both labels link to the corresponding deck or profile',
  async (t) => {
    const fromBob = {
      recipient_user_id: OWNER_ID,
      actor_user_id: INVITED_ID,
      created_at: 1,
    }
    await db.insert(notifications).values([
      {
        ...fromBob,
        id: 'publication',
        kind: 'followee_published',
        deck_id: response,
      },
      { ...fromBob, id: 'follow', kind: 'followed' },
    ])
    const page = await pageAt(`/notifications?lang=${t.lang}`)
    const metadata = `${dayFormats[t.lang].format(1000)} ${t.fresh}`
    expect(linkLabel(page, `/@bob/${response}`)).toBe(
      `${t.published} ${metadata}`,
    )
    expect(linkLabel(page, '/@bob')).toBe(`${t.followed} ${metadata}`)
    expect(page).not.toContain(title)
  },
)

test.each(locales)(
  'F20-AC1: Given no notifications, When Alice opens the $lang list, Then it shows the empty state',
  async (t) => {
    expect(await pageAt(`/notifications?lang=${t.lang}`)).toContain(t.empty)
  },
)

test('F20-AC1: Given both titles are missing, When Alice opens her list, Then the citation names both slugs and links to the citing deck', async () => {
  await seedDeck(database, 'untitled-original')
  await seedPublic(database, 'untitled-response', 1, null, INVITED_ID)
  await cited('untitled-response', 'untitled-original')
  const page = await pageAt('/notifications?lang=en')
  expect(linkLabel(page, '/@bob/untitled-response')).toBe(
    `@bob's slides “untitled-response” cite your slides “untitled-original” ${dayFormats.en.format(citedAt * 1000)} New`,
  )
})

test.each(locales)(
  'F20-AC2: Given one unread citation and a read join, When Alice opens the $lang list twice, Then only the first visit marks the citation and the count on her bell clears',
  async (t) => {
    await joined(OWNER_ID, INVITED_ID, 1)
    await cited()
    const list = `/notifications?lang=${t.lang}`
    expect(await bellCount()).toBe(1)
    const first = await pageAt(list)
    const unread = first.match(
      /<li\b[^>]*\bclass="[^"]*\bunread\b[^"]*"[^>]*>[\s\S]*?<\/li>/g,
    )
    expect(unread).toHaveLength(1)
    expect(unread?.[0]).toContain(`href="/@bob/${response}"`)
    expect(unread?.[0]).toContain('class="unread-dot"')
    expect(unread?.[0]).toContain(`>${t.fresh}<`)
    expect(await bellCount()).toBe(0)
    const second = await pageAt(list)
    expect(second).not.toMatch(/<li\b[^>]*\bclass="[^"]*\bunread\b/)
    expect(second).not.toContain(`>${t.fresh}<`)
    expect(linkLabel(second, `/@bob/${response}`)).toBe(
      `${t.cited} ${dayFormats[t.lang].format(citedAt * 1000)}`,
    )
  },
)

async function publishCitation(slug: string) {
  await seedDeck(database, slug, INVITED_ID)
  const deploymentId = await seedDeployment(database, slug)
  await db.insert(citations).values({
    deployment_id: deploymentId,
    target_handle: 'alice',
    target_slug: original,
  })
  const result = await applyAuthorCommand(database, {
    ownerUserId: INVITED_ID,
    deckId: slug,
    expectedRevision: 0,
    command: { kind: 'publish', deploymentId },
    now: citedAt,
  })
  expect(result.kind).toBe('applied')
}

async function preferenceRows(lang: 'ja' | 'en' = 'ja') {
  const settings = await pageAt(`/settings?lang=${lang}`)
  const section =
    /<section\b[^>]*\bid="notifications"[^>]*>([\s\S]*?)<\/section>/.exec(
      settings,
    )?.[1]
  expect(section).toContain(
    lang === 'ja' ? '<h2>お知らせ</h2>' : '<h2>Notifications</h2>',
  )
  return [...(section ?? '').matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(
    ([, row]) => row,
  )
}

function expectPreference(
  rows: string[],
  kind: string,
  label: string,
  receive: boolean,
  lang: 'ja' | 'en' = 'ja',
) {
  const row = rows.find((item) => item.includes(`value="${kind}"`))
  const state = {
    ja: receive ? '受け取る' : '受け取らない',
    en: receive ? 'Receiving' : 'Not receiving',
  }
  const name = {
    ja: receive
      ? `「${label}」の受け取りを止める`
      : `「${label}」を受け取るようにする`,
    en: `${receive ? 'Stop' : 'Start'} receiving “${label}” notifications`,
  }
  const visible = row?.replace(/<button\b[^>]*>[\s\S]*?<\/button>/g, '')
  expect(visible).toContain(label)
  expect(visible).toContain(state[lang])
  expect(row).toContain('method="post"')
  expect(row).toContain('action="/notifications/preferences"')
  expect(row).toMatch(/\bname="kind"/)
  expect(row).toMatch(
    new RegExp(`<[^>]*name="receive"[^>]*value="${receive ? '0' : '1'}"`),
  )
  expect(row?.match(/<button\b[^>]*\baria-label="([^"]*)"/)?.[1]).toBe(
    name[lang],
  )
}

test('F20-AC7: Given all four kinds are received by default, When Alice turns citations off and back on around two publications, Then only the second citation arrives', async () => {
  const citationLabel = '自分のスライドが引用された'
  const joinLabel = 'GitHub でフォローしている人が、Slide を使い始めた'
  const defaults = await preferenceRows()
  expect(defaults).toHaveLength(4)
  expectPreference(defaults, 'cited', citationLabel, true)
  expectPreference(defaults, 'github_followee_joined', joinLabel, true)
  expectPreference(
    defaults,
    'followee_published',
    'フォローしている人が、スライドを公開した',
    true,
  )
  expectPreference(defaults, 'followed', 'フォローされた', true)
  expectRedirect(
    await postPreference({ kind: 'cited', receive: '0' }),
    '/settings#notifications',
  )
  const updated = await preferenceRows()
  expectPreference(updated, 'cited', citationLabel, false)
  expectPreference(updated, 'github_followee_joined', joinLabel, true)
  await publishCitation('skipped')
  expect(await pageAt('/notifications')).toContain('お知らせはありません。')

  expectRedirect(
    await postPreference({ kind: 'cited', receive: '1' }),
    '/settings#notifications',
  )
  expectPreference(await preferenceRows(), 'cited', citationLabel, true)
  await publishCitation('delivered')
  const page = await pageAt('/notifications')
  expect(page).toContain('href="/@bob/delivered"')
  expect(page).not.toContain('/@bob/skipped')
})

test('F20-AC7: Given Alice reads English and receives all four kinds, When she disables join notifications, Then only the GitHub preference changes', async () => {
  expectRedirect(
    await postPreference({ kind: 'github_followee_joined', receive: '0' }),
    '/settings#notifications',
  )
  const settings = await preferenceRows('en')
  expect(settings).toHaveLength(4)
  expectPreference(
    settings,
    'github_followee_joined',
    'Someone you follow on GitHub started using Slide',
    false,
    'en',
  )
  expectPreference(settings, 'cited', 'Your slides were cited', true, 'en')
  expectPreference(
    settings,
    'followee_published',
    'Someone you follow published slides',
    true,
    'en',
  )
  expectPreference(settings, 'followed', 'Someone followed you', true, 'en')
  expect(await db.select().from(notificationOptOuts)).toEqual([
    { user_id: OWNER_ID, kind: 'github_followee_joined' },
  ])
})

test.each([
  { kind: 'unknown', receive: '0' },
  { kind: 'cited', receive: 'yes' },
  { kind: 'github_followee_joined', receive: '' },
])(
  'Given invalid preference $kind/$receive, When Alice submits it, Then the settings redirect leaves her opt-outs intact',
  async (fields) => {
    expectRedirect(
      await postPreference({ kind: 'github_followee_joined', receive: '0' }),
      '/settings#notifications',
    )
    expectRedirect(await postPreference(fields), '/settings#notifications')
    expect(await db.select().from(notificationOptOuts)).toEqual([
      { user_id: OWNER_ID, kind: 'github_followee_joined' },
    ])
  },
)

test('Given a foreign Origin, When Alice submits a preference, Then CSRF rejects it and all kinds are still received', async () => {
  const result = await postPreference(
    { kind: 'cited', receive: '0' },
    alice,
    'https://other.example',
  )
  expect(result.status).toBe(403)
  expect(await db.select().from(notificationOptOuts)).toEqual([])
})

test('F20-AC9: Given Alice has two notifications and Bob has one, When Bob asks his bell’s count and opens his list, Then he sees and marks only his own notification', async () => {
  await joined()
  await cited()
  await joined(INVITED_ID, OWNER_ID)
  expect(await bellCount(bob)).toBe(1)
  const page = await pageAt('/notifications', bob)
  expect(linkLabel(page, '/@alice')).toContain('@alice')
  expect(page).not.toContain('href="/@bob"')
  expect(page).not.toContain(`href="/@bob/${response}"`)
  expect(await bellCount(bob)).toBe(0)
  expect(await bellCount()).toBe(2)
})

test('F20-AC9: Given a signed-out visitor and an unread notification for Alice, When the visitor opens the list or posts a preference, Then sign-in is required and Alice’s data is unchanged', async () => {
  await joined()
  const result = await get('/notifications', '')
  expect(result.status).toBe(401)
  const page = await result.text()
  expect(page).toContain('GitHub でログイン')
  expect(page).not.toContain('@bob')
  expect(page).not.toContain('使い始めました')
  expectRedirect(
    await postPreference({ kind: 'cited', receive: '0' }, ''),
    '/settings',
  )
  expect(await db.select().from(notificationOptOuts)).toEqual([])
  expect(await bellCount()).toBe(1)
})

test('Given a suspended owner, When she opens notifications and posts a preference, Then both return the suspension page and leave her data unchanged', async () => {
  await joined()
  await db.insert(suspensions).values({
    user_id: OWNER_ID,
    reason: 'suspended',
    suspended_at: 300,
    suspended_by: 'operator',
  })
  for (const result of [
    await get('/notifications'),
    await postPreference({ kind: 'cited', receive: '0' }),
  ]) {
    expect(result.status).toBe(403)
    expect(await result.text()).toContain('<h1>アカウントは停止中です</h1>')
  }
  expect(
    await db.select({ read: notifications.read_at }).from(notifications),
  ).toEqual([{ read: null }])
  expect(await db.select().from(notificationOptOuts)).toEqual([])
})
