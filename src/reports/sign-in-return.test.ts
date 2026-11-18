import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import { OWNER_ID, TEST_ORIGIN, testEnv } from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
beforeAll(() => applyMigrations(platform.env.DB))
afterAll(() => platform.dispose())

/** Runs the GitHub sign-in started with `to`, and returns where it ends. */
async function signInFrom(to: string): Promise<string | null> {
  const start = await server.fetch(
    new Request(`${TEST_ORIGIN}/auth/github?to=${encodeURIComponent(to)}`),
    env,
  )
  const state = new URL(start.headers.get('location') ?? '').searchParams.get(
    'state',
  )
  vi.stubGlobal('fetch', async (input: RequestInfo) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.endsWith('/user/emails')) return Response.json([])
    if (url.endsWith('/access_token'))
      return Response.json({ access_token: 'gho_x' })
    if (url.endsWith('/user'))
      return Response.json({ id: Number(OWNER_ID), login: 'owner' })
    return new Response(null, { status: 204 })
  })
  const oauth = start.headers.getSetCookie()[0]?.split(';')[0] ?? ''
  const callback = await server.fetch(
    new Request(`${TEST_ORIGIN}/auth/github/callback?code=c&state=${state}`, {
      headers: { Cookie: oauth },
    }),
    env,
  )
  vi.unstubAllGlobals()
  const location = callback.headers.get('location')
  return location && new URL(location, TEST_ORIGIN).pathname
}

test.each(['/@owner/talk', '/@owner/talk/3'])(
  'F17-AC18: Given sign-in started from the slide %s, When GitHub sign-in completes, Then the reader is back on that slide',
  async (slide) => {
    expect(await signInFrom(slide)).toBe(slide)
  },
)

test.each([
  'https://elsewhere.example/@owner/talk',
  '//elsewhere.example',
  '/@Owner',
])(
  'F17-AC18: Given sign-in started with %s, When GitHub sign-in completes, Then it ends on the decks page',
  async (to) => {
    expect(await signInFrom(to)).toBe('/slides')
  },
)

test('F21-AC1: Given sign-in started from the profile /@owner, When GitHub sign-in completes, Then the reader is back on that profile', async () => {
  expect(await signInFrom('/@owner')).toBe('/@owner')
})
