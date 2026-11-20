import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { deployments, pageScriptDeployments } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
await applyMigrations(db)

/** Counts what reaches the browser binding; opening a viewer starts none. */
let shots = 0
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  BROWSER: {
    shoot: async () => {
      shots += 1
      return new Response('jpeg', { headers: { 'Content-Type': 'image/jpeg' } })
    },
  },
} as unknown as Env

let talk = ''
beforeEach(async () => {
  await resetTables(db)
  shots = 0
  // The author's handle is recorded at sign-in.
  await signIn(env)
  talk = await seedPublic(db, 'talk', 100, 'Talk')
})
afterAll(() => platform.dispose())

const noteAsPaged = () =>
  orm.insert(pageScriptDeployments).values({ deployment_id: talk })
const nameOwnCover = () =>
  orm
    .update(deployments)
    .set({ cover_path: 'images/og.png' })
    .where(eq(deployments.id, talk))

/** The og:image a share URL's viewer offers. */
async function imageOf(path: string) {
  const response = await server.fetch(new Request(`${TEST_ORIGIN}${path}`), env)
  expect(response.status).toBe(200)
  const page = await response.text()
  const image = /<meta property="og:image" content="([^"]*)" \/>/.exec(page)
  return { image: image?.[1], page }
}
const COVER = () => `${TEST_ORIGIN}/covers/${talk}.jpg`
const OWN_COVER = () => `https://d-${talk}.content.example/images/og.png`

test('F05-AC4: Given a public deck that loads the page script, When /@handle/slug/6 is opened, Then og:image is the URL of the image of page 6, which answers with a JPEG', async () => {
  await noteAsPaged()

  const { image, page } = await imageOf('/@owner/talk/6')

  expect(image).toBe(`${TEST_ORIGIN}/covers/${talk}/6.jpg`)
  expect(page).toContain(
    `<meta property="og:url" content="${TEST_ORIGIN}/@owner/talk/6" />`,
  )
  expect(page).toContain(
    '<meta name="twitter:card" content="summary_large_image" />',
  )
  // Offering the image takes none; a service that follows it gets a JPEG.
  expect(shots).toBe(0)
  const taken = await server.fetch(new Request(image ?? ''), env)
  expect(taken.status).toBe(200)
  expect(taken.headers.get('Content-Type')).toBe('image/jpeg')
})

test('F05-AC6: Given a public deck that loads the page script, When /@handle/slug is opened, Then og:image is the cover, as before', async () => {
  await noteAsPaged()

  expect((await imageOf('/@owner/talk')).image).toBe(COVER())
})

test('F05-AC6: Given a public deck that names its own cover and loads the page script, When /@handle/slug is opened, Then og:image is that cover, as before', async () => {
  await noteAsPaged()
  await nameOwnCover()

  expect((await imageOf('/@owner/talk')).image).toBe(OWN_COVER())
})

test('F05-AC7: Given a public deck that names its own cover and loads the page script, When /@handle/slug/6 is opened, Then og:image is the image of page 6', async () => {
  await noteAsPaged()
  await nameOwnCover()

  expect((await imageOf('/@owner/talk/6')).image).toBe(
    `${TEST_ORIGIN}/covers/${talk}/6.jpg`,
  )
})

test('F05-AC8: Given a public deck that does not load the page script, When /@handle/slug/6 is opened, Then og:image is the cover and the deck still opens at page 6', async () => {
  const { image, page } = await imageOf('/@owner/talk/6')

  expect(image).toBe(COVER())
  expect(page).toContain(`https://d-${talk}.content.example/#6`)
})

test('F05-AC8: Given a public deck that names its own cover and does not load the page script, When /@handle/slug/6 is opened, Then og:image is that cover', async () => {
  await nameOwnCover()

  expect((await imageOf('/@owner/talk/6')).image).toBe(OWN_COVER())
})

test.each([
  [200, (id: string) => `${TEST_ORIGIN}/covers/${id}/200.jpg`],
  [201, (id: string) => `${TEST_ORIGIN}/covers/${id}.jpg`],
  [9999, (id: string) => `${TEST_ORIGIN}/covers/${id}.jpg`],
])(
  'F05-AC9: Given a public deck that loads the page script, When /@handle/slug/%i is opened, Then og:image is a page up to 200 and the cover past it, and no browser runs',
  async (number, expected) => {
    await noteAsPaged()

    const { image, page } = await imageOf(`/@owner/talk/${number}`)

    expect(image).toBe(expected(talk))
    // Past 200 the deck still opens at the page; only the image is the cover.
    expect(page).toContain(`https://d-${talk}.content.example/#${number}`)
    expect(shots).toBe(0)
  },
)

test('F05-AC9: Given a public deck that loads the page script, When the image of page 201 is asked for directly, Then it is not found and no browser runs', async () => {
  await noteAsPaged()

  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/covers/${talk}/201.jpg`),
    env,
  )

  expect(response.status).toBe(404)
  expect(shots).toBe(0)
})
