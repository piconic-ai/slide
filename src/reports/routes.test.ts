import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { decks, reports } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { applyOperatorCommand } from '../publication/takedown-store'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = withInvited(testEnv(platform.env))
const slide = '/@owner/talk/3'
const formPath = `/reports/new?slide=${encodeURIComponent(slide)}`
const receivedPath = `${formPath}&result=received`
let reader = ''
let deploymentId = ''

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await db.delete(reports)
  await resetTables(database)
  await signIn(env)
  reader = await signIn(env, 'reader', { id: INVITED_ID })
  deploymentId = await seedPublic(
    database,
    'deck-key',
    1,
    'A public deck',
    OWNER_ID,
    'talk',
  )
})
afterAll(() => platform.dispose())

const open = (path: string, cookie = reader) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, { headers: { Cookie: cookie } }),
    env,
  )

const post = (
  fields: Record<string, string>,
  cookie = reader,
  origin: string | null = TEST_ORIGIN,
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/reports`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(origin === null ? {} : { Origin: origin }),
      },
      body: new URLSearchParams(fields),
    }),
    env,
  )

test.each(['nuisance', 'rights', 'other'])(
  'F17-AC16: Given a public deck and reason %s, When a reader reports it, Then its current deployment and share path are saved',
  async (reason) => {
    const replacement = await seedDeployment(database, 'deck-key')
    await db
      .update(decks)
      .set({ public_deployment_id: replacement })
      .where(eq(decks.id, 'deck-key'))
    const response = await post({ slide, reason, note: '  Page three  ' })

    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe(receivedPath)
    expect(await db.select().from(reports)).toEqual([
      expect.objectContaining({
        deck_id: 'deck-key',
        deployment_id: replacement,
        share_path: slide,
        reason,
        note: 'Page three',
        reporter_user_id: INVITED_ID,
        created_at: expect.any(Number),
        updated_at: expect.any(Number),
      }),
    ])
  },
)

test('F17-AC16: Given a whole-deck share path and no details, When a reader reports abuse, Then the deck path and empty note are saved', async () => {
  const response = await post({ slide: '/@owner/talk', reason: 'nuisance' })
  expect(response.status).toBe(303)
  expect(await db.select().from(reports)).toEqual([
    expect.objectContaining({
      share_path: '/@owner/talk',
      deployment_id: deploymentId,
      note: '',
    }),
  ])
})

test.each([
  ['nuisance', 'x'.repeat(501), '説明は500文字以内で入力してください。'],
  ['other', ' \n', '「その他」を選んだときは説明を入力してください。'],
  ['unknown', 'details', '通報の理由を選んでください。'],
])(
  'F17-AC16: Given invalid reason or details %s, When submitted, Then the form explains the error and nothing is saved',
  async (reason, note, message) => {
    const response = await post({ slide, reason, note })
    expect(response.status).toBe(400)
    const page = await response.text()
    expect(page).toContain(message)
    expect(page).toContain('action="/reports"')
    expect(page).toContain(`value="${slide}"`)
    expect(await db.select().from(reports)).toEqual([])
  },
)

test('F17-AC16: Given an uploaded file as details, When submitted, Then the form rejects it and nothing is saved', async () => {
  const body = new FormData()
  body.set('slide', slide)
  body.set('reason', 'nuisance')
  body.set('note', new File(['details'], 'note.txt'))
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/reports`, {
      method: 'POST',
      headers: { Cookie: reader, Origin: TEST_ORIGIN },
      body,
    }),
    env,
  )
  expect(response.status).toBe(400)
  expect(await response.text()).toContain('説明はテキストで入力してください。')
  expect(await db.select().from(reports)).toEqual([])
})

test('F17-AC16: Given Other without a note field, When submitted, Then details are required and nothing is saved', async () => {
  const response = await post({ slide, reason: 'other' })
  expect(response.status).toBe(400)
  expect(await response.text()).toContain(
    '「その他」を選んだときは説明を入力してください。',
  )
  expect(await db.select().from(reports)).toEqual([])
})

test('F17-AC16: Given markup in invalid form details, When the form is shown again, Then the details are escaped as text', async () => {
  const note = '</textarea><script>alert(1)</script>'
  const response = await post({ slide, reason: 'unknown', note })
  expect(response.status).toBe(400)
  const page = await response.text()
  expect(page).not.toContain(note)
  expect(page).toContain(
    '<textarea class="text-input" name="note" maxlength="500" rows="5">&lt;/textarea&gt;&lt;script&gt;alert(1)&lt;/script&gt;</textarea>',
  )
  expect(await db.select().from(reports)).toEqual([])
})

test.each(['private', 'hidden', 'unknown'])(
  'F17-AC16, F17-AC36: Given a %s deck, When its report form is opened or posted, Then it is not found, no frame shows it, and nothing is saved',
  async (state) => {
    if (state === 'private')
      await db
        .update(decks)
        .set({ public_deployment_id: null })
        .where(eq(decks.id, 'deck-key'))
    if (state === 'hidden')
      await applyOperatorCommand(database, {
        deckId: 'deck-key',
        command: {
          kind: 'hide',
          reason: 'fake sign-in page',
          operator: 'operator@example.com',
        },
        now: 100,
      })
    const path = state === 'unknown' ? '/@owner/unknown' : slide
    const getResponse = await open(
      `/reports/new?slide=${encodeURIComponent(path)}`,
    )
    const postResponse = await post({ slide: path, reason: 'nuisance' })
    expect(getResponse.status).toBe(404)
    expect(postResponse.status).toBe(404)
    expect(await getResponse.text()).not.toContain('<iframe')
    expect(await postResponse.text()).not.toContain('<iframe')
    expect(await db.select().from(reports)).toEqual([])
  },
)

test.each([
  '',
  '/@owner',
  '/slides',
  'https://example.com/@owner/talk',
  '//example.com/@owner/talk',
  '/%40owner/talk',
  '/@owner/talk%2f3',
])(
  'F17-AC16: Given invalid slide path %s, When the report form is opened or posted, Then it is not found and nothing is saved',
  async (path) => {
    expect(
      (await open(`/reports/new?slide=${encodeURIComponent(path)}`)).status,
    ).toBe(404)
    expect((await post({ slide: path, reason: 'nuisance' })).status).toBe(404)
    expect(await db.select().from(reports)).toEqual([])
  },
)

test.each([null, 'https://elsewhere.example'])(
  'F17-AC16: Given Origin %j, When a report is posted, Then CSRF protection refuses it and nothing is saved',
  async (origin) => {
    const response = await post({ slide, reason: 'nuisance' }, reader, origin)
    expect(response.status).toBe(403)
    expect(await db.select().from(reports)).toEqual([])
  },
)

test('F17-AC18: Given a signed-out reader, When the report form is opened, Then sign-in is required with the slide as its return destination', async () => {
  const response = await open(formPath, '')
  expect(response.status).toBe(401)
  const page = await response.text()
  expect(page).toContain('通報するには、ログインが必要です。')
  expect(page).toContain(`href="/login?to=${encodeURIComponent(slide)}"`)
  expect(page).not.toContain('action="/reports"')
})

test('F17-AC18: Given a signed-out reader, When a report is posted, Then sign-in is required and nothing is saved', async () => {
  const response = await post({ slide, reason: 'nuisance' }, '')
  expect(response.status).toBe(401)
  const page = await response.text()
  expect(page).toContain('通報するには、ログインが必要です。')
  expect(page).toContain(`href="/login?to=${encodeURIComponent(slide)}"`)
  expect(await db.select().from(reports)).toEqual([])
})

test('F17-AC34, F17-AC35: Given a signed-in reader, When the report form is opened for page 3, Then the reasons sit in a fieldset with a legend, each mark inside its label beside its words, and the slides’ embed page is framed', async () => {
  const page = await (await open(formPath)).text()
  expect(page).toMatch(
    /<fieldset class="choices">\s*<legend>通報の理由<\/legend>/,
  )
  const choices = page.match(/<label class="choice">[\s\S]*?<\/label>/g) ?? []
  expect(choices).toHaveLength(3)
  for (const choice of choices) {
    expect(choice).toMatch(/<input\s[^>]*type="radio"/)
    expect(choice).toMatch(/<span>[^<]+<\/span>/)
  }
  const frames = page.match(/<iframe\b[^>]*>/g) ?? []
  expect(frames).toHaveLength(1)
  expect(frames[0]).toContain('src="/embed/@owner/talk/3"')
  expect(frames[0]).toContain('title="通報するスライド: /@owner/talk/3"')
})

test('F17-AC36: Given a signed-in reader, When the report form is opened or shown again with an error, Then the policy adds frame-src self and nothing else, and the received page needs no frame', async () => {
  const policies = [
    (await open(formPath)).headers.get('Content-Security-Policy'),
    (await post({ slide, reason: 'unknown' })).headers.get(
      'Content-Security-Policy',
    ),
  ]
  for (const policy of policies) {
    expect(policy).toContain("frame-src 'self'")
    expect(policy).not.toMatch(/frame-src[^;]*(\*|https?:)/)
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("frame-ancestors 'none'")
  }
  const received = await open(receivedPath)
  expect(received.headers.get('Content-Security-Policy')).not.toContain(
    'frame-src',
  )
  expect(await received.text()).not.toContain('<iframe')
})

test.each([
  ['ja', '通報する', '説明(任意。「その他」のときは必須。500 文字まで)'],
  [
    'en',
    'Report',
    'Details (optional; required for Other; up to 500 characters)',
  ],
])(
  'F17-AC16: Given a signed-in reader using %s, When the report form is opened, Then it offers the three reasons and bounded details',
  async (lang, title, noteLabel) => {
    const response = await open(`${formPath}&lang=${lang}`)
    expect(response.status).toBe(200)
    const page = await response.text()
    expect(page).toContain(`<h1>${title}</h1>`)
    expect(page).toContain(noteLabel)
    expect(page.match(/type="radio"/g)).toHaveLength(3)
    for (const reason of ['nuisance', 'rights', 'other'])
      expect(page).toContain(`value="${reason}"`)
    expect(page).toContain('maxlength="500"')
    expect(page).toContain(`value="${slide}"`)
    expect(page).toContain('action="/reports"')
  },
)

test.each([
  ['ja', '通報を受け付けました。'],
  ['en', 'Your report was received.'],
])(
  'F17-AC16: Given a received result in %s, When the reader follows the redirect, Then confirmation and a link to the slide replace the form',
  async (lang, message) => {
    const response = await open(`${receivedPath}&lang=${lang}`)
    expect(response.status).toBe(200)
    const page = await response.text()
    expect(page).toContain(message)
    expect(page).toContain(`href="${slide}"`)
    expect(page).not.toContain('action="/reports"')
  },
)

test('F17-AC18: Given a signed-out reader using English, When the form is opened, Then the sign-in prompt is in English', async () => {
  const response = await open(`${formPath}&lang=en`, '')
  expect(response.status).toBe(401)
  expect(await response.text()).toContain('Sign in to report.')
})

test('F17-AC25: Given an existing report from a reader, When that reader reports the deck again, Then one row has the second reason and both responses look the same', async () => {
  const first = await post({ slide, reason: 'nuisance', note: 'first' })
  const firstConfirmation = await (await open(receivedPath)).text()
  const original = await db.select().from(reports).get()
  expect(original).toBeDefined()
  const second = await post({ slide, reason: 'rights', note: 'second' })

  expect(first.status).toBe(303)
  expect(second.status).toBe(first.status)
  expect(first.headers.get('Location')).toBe(receivedPath)
  expect(second.headers.get('Location')).toBe(first.headers.get('Location'))
  expect(await second.text()).toBe(await first.text())
  expect(await (await open(receivedPath)).text()).toBe(firstConfirmation)
  expect(await db.select().from(reports)).toEqual([
    expect.objectContaining({
      id: original?.id,
      created_at: original?.created_at,
      reason: 'rights',
      note: 'second',
    }),
  ])
})
