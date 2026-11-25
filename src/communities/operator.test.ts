import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { communities, communityAdmins, handles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { ACCESS_TOKEN_HEADER } from '../operator/access'
import {
  accessTeam,
  AUDIENCE,
  OPERATOR_ORIGIN,
  TEAM,
} from '../operator/test-support'
import {
  OWNER_ID,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { resetCommunities, seedCommunity } from './test-communities'

const team = await accessTeam()
vi.mock('../operator/access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
} as unknown as Env

const ID = 81
let owner = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetCommunities(db)
  owner = await signIn(env)
  await signIn(env, 'bob', { id: '2' })
  await seedCommunity(db, {
    id: ID,
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: ['https://kanagawapm.connpass.com/'],
    creator: OWNER_ID,
  })
})
afterAll(() => platform.dispose())

async function operate(
  path: string,
  fields: Record<string, string>,
  token = true,
) {
  return server.fetch(
    new Request(`${OPERATOR_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: OPERATOR_ORIGIN,
        ...(token ? { [ACCESS_TOKEN_HEADER]: await team.sign() } : {}),
      },
      body: new URLSearchParams(fields),
    }),
    env,
  )
}
const admins = async () =>
  (await orm.select().from(communityAdmins)).map((row) => row.user_id).sort()

test('F30-AC36: Given the operator page, When it opens, Then it lists the communities with their admins and the operations', async () => {
  const body = (
    await (
      await server.fetch(
        new Request(`${OPERATOR_ORIGIN}/`, {
          headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
        }),
        env,
      )
    ).text()
  ).replace(/\s+/g, ' ')
  expect(body).toContain('<h2>コミュニティ</h2>')
  expect(body).toContain('<code>@kanagawapm</code>')
  expect(body).toContain('<code>@owner</code>')
  for (const action of [
    '/communities/admins/add',
    '/communities/admins/remove',
    '/communities/rename',
    '/communities/delete',
  ])
    expect(body).toContain(`action="${action}"`)
})

test('F30-AC36: Given the operator, When they add bob and remove the owner, Then bob runs the community; the last one cannot be removed', async () => {
  expect(
    (
      await operate('/communities/admins/add', {
        community: '@kanagawapm',
        person: 'bob',
      })
    ).headers.get('location'),
  ).toBe('/?result=community_admin_added')
  expect(
    (
      await operate('/communities/admins/add', {
        community: 'kanagawapm',
        person: 'bob',
      })
    ).headers.get('location'),
  ).toBe('/?result=community_admin_already')
  expect(
    (
      await operate('/communities/admins/remove', {
        community: 'kanagawapm',
        person: '@owner',
      })
    ).headers.get('location'),
  ).toBe('/?result=community_admin_removed')
  expect(await admins()).toEqual(['2'])
  expect(
    (
      await operate('/communities/admins/remove', {
        community: 'kanagawapm',
        person: 'bob',
      })
    ).headers.get('location'),
  ).toBe('/?result=community_admin_last')
  expect(await admins()).toEqual(['2'])
})

test('F30-AC36: F30-AC7: Given the operator, When they change the handle, Then the old URL moves to the new one', async () => {
  expect(
    (
      await operate('/communities/rename', {
        community: 'kanagawapm',
        to: 'kanagawa',
      })
    ).headers.get('location'),
  ).toBe('/?result=community_renamed')
  const old = await server.fetch(
    new Request(`${TEST_ORIGIN}/@kanagawapm/slides`),
    env,
  )
  expect(old.status).toBe(301)
  expect(old.headers.get('location')).toBe('/@kanagawa/slides')
  expect(
    (await server.fetch(new Request(`${TEST_ORIGIN}/@kanagawa`), env)).status,
  ).toBe(200)
  expect(
    (
      await operate('/communities/rename', { community: 'kanagawa', to: 'bob' })
    ).headers.get('location'),
  ).toBe('/?result=community_handle_taken')
  expect(
    (
      await operate('/communities/rename', {
        community: 'kanagawa',
        to: 'events',
      })
    ).headers.get('location'),
  ).toBe('/?result=community_handle_invalid')
})

test('F30-AC36: Given the operator, When they delete with the handle confirmed, Then the community goes; a wrong confirmation deletes nothing', async () => {
  expect(
    (
      await operate('/communities/delete', {
        community: 'kanagawapm',
        confirm: 'other',
      })
    ).headers.get('location'),
  ).toBe('/?result=community_confirm_mismatch')
  expect(await orm.select().from(communities)).toHaveLength(1)
  expect(
    (
      await operate('/communities/delete', {
        community: 'kanagawapm',
        confirm: 'kanagawapm',
      })
    ).headers.get('location'),
  ).toBe('/?result=community_deleted')
  expect(await orm.select().from(communities)).toEqual([])
  expect(
    await orm.select().from(handles).where(eq(handles.handle, 'kanagawapm')),
  ).toEqual([])
})

test('F30-AC36: Given a request without the operator’s token, a person’s handle, or another origin, When it is sent, Then nothing changes', async () => {
  expect(
    (
      await operate(
        '/communities/admins/add',
        { community: 'kanagawapm', person: 'bob' },
        false,
      )
    ).status,
  ).toBe(404)
  expect(
    (
      await operate('/communities/delete', {
        community: 'owner',
        confirm: 'owner',
      })
    ).headers.get('location'),
  ).toBe('/?result=community_not_found')
  const foreign = await server.fetch(
    new Request(`${OPERATOR_ORIGIN}/communities/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://evil.example',
        [ACCESS_TOKEN_HEADER]: await team.sign(),
      },
      body: 'community=kanagawapm&confirm=kanagawapm',
    }),
    env,
  )
  expect(foreign.status).toBe(403)
  // On the public host, the operator's paths are not there at all.
  const publicHost = await server.fetch(
    new Request(`${TEST_ORIGIN}/communities/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: TEST_ORIGIN,
        Cookie: owner,
      },
      body: 'community=kanagawapm&confirm=kanagawapm',
    }),
    env,
  )
  expect(publicHost.status).toBe(404)
  expect(await admins()).toEqual([OWNER_ID])
  expect(await orm.select().from(communities)).toHaveLength(1)
})
