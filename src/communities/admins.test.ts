import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import {
  communities,
  communityAdmins,
  communityLinks,
  events,
  handles,
  relatedLinks,
  releasedHandles,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { markAccountDeleted } from '../decks/deletion-store'
import { HANDLE_HOLD_SECONDS } from '../handles/hold'
import { handleAvailability } from '../handles/store'
import { png } from '../profile/test-picture'
import {
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import type { Handle } from '../share/handle'
import { removeCommunityAdmin } from './admin-store'
import { imageKey } from './image-policy'
import { checkCommunityLinks } from './link-rules'
import { replaceCommunityLinks } from './store'
import {
  resetCommunities,
  seedCommunity,
  seedTalkLink,
} from './test-communities'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const bucket = platform.env.UPLOADS
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

const ID = 61
const BOB = '2'
let owner = ''
let bob = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetCommunities(db)
  owner = await signIn(env)
  bob = await signIn(env, 'bob', { id: BOB })
  await seedCommunity(db, {
    id: ID,
    handle: 'kanagawapm',
    links: ['https://kanagawapm.connpass.com/'],
    creator: OWNER_ID,
  })
})
afterAll(() => platform.dispose())

const post = (
  path: string,
  fields: ReadonlyArray<readonly [string, string]>,
  cookie = owner,
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields.map(([k, v]) => [k, v])).toString(),
    }),
    env,
  )
const open = (path: string, cookie = owner) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
  )
const flat = async (response: Response) =>
  (await response.text()).replace(/\s+/g, ' ')
const admins = async () =>
  (
    await orm
      .select()
      .from(communityAdmins)
      .where(eq(communityAdmins.community_id, ID))
  )
    .map((row) => row.user_id)
    .sort()

/** The opening tag of the button whose words are `words`. */
const leaveButton = (body: string, words: string) =>
  new RegExp(`<button[^>]*> ${words} </button>`).exec(body)?.[0] ?? ''

describe('admins', () => {
  test('F30-AC27: Given an admin, When they add a person by handle, Then that person may edit too', async () => {
    const response = await post(`/communities/${ID}/admins`, [
      ['handle', '@bob'],
    ])
    expect(response.headers.get('Location')).toBe(
      '/@kanagawapm/edit?notice=admin-added',
    )
    expect(await admins()).toEqual([BOB, OWNER_ID].sort())
    expect((await open('/@kanagawapm/edit', bob)).status).toBe(200)
    expect(await flat(await open('/@kanagawapm/edit', bob))).toContain(
      '@owner を管理者から外す',
    )
  })

  test('F30-AC27: Given a handle of nobody or of a community, When it is added, Then nobody is added and the reason shows', async () => {
    await seedCommunity(db, {
      id: 70,
      handle: 'hono',
      links: ['https://hono.connpass.com/'],
    })
    for (const handle of ['nobody', 'hono', 'BAD!']) {
      const response = await post(`/communities/${ID}/admins`, [
        ['handle', handle],
      ])
      expect(response.headers.get('Location')).toBe(
        '/@kanagawapm/edit?notice=admin-unknown',
      )
    }
    expect(await admins()).toEqual([OWNER_ID])
    expect(
      await flat(await open('/@kanagawapm/edit?notice=admin-unknown')),
    ).toContain('そのハンドルの人が見つかりません。')
  })

  test('F30-AC27: Given two admins, When one removes the other and then the other leaves by themself, Then each goes', async () => {
    await post(`/communities/${ID}/admins`, [['handle', 'bob']])
    expect(
      (await post(`/communities/${ID}/admins/${BOB}/remove`, [])).headers.get(
        'Location',
      ),
    ).toBe('/@kanagawapm/edit?notice=admin-removed')
    expect(await admins()).toEqual([OWNER_ID])
    await post(`/communities/${ID}/admins`, [['handle', 'bob']])
    const left = await post(`/communities/${ID}/admins/${OWNER_ID}/remove`, [])
    expect(left.headers.get('Location')).toBe('/@kanagawapm')
    expect(await admins()).toEqual([BOB])
    expect((await open('/@kanagawapm/edit')).status).toBe(404)
  })

  test('F30-AC28: Given the last admin, When they leave, Then they stay, and the reason shows', async () => {
    const response = await post(
      `/communities/${ID}/admins/${OWNER_ID}/remove`,
      [],
    )
    expect(response.headers.get('Location')).toBe(
      '/@kanagawapm/edit?notice=admin-last',
    )
    expect(await admins()).toEqual([OWNER_ID])
    expect(
      await flat(await open('/@kanagawapm/edit?notice=admin-last')),
    ).toContain('最後の管理者は外れられません。')
  })

  test.each([
    [
      '',
      '管理者から外れる',
      '最後の管理者は外れられません。ほかの管理者を足してから外れてください。',
    ],
    [
      '?lang=en',
      'Stop being an admin',
      'The last admin cannot leave. Add another admin before leaving.',
    ],
  ])(
    'F30-AC52: Given the only admin, When the editing page%s is drawn, Then "stop being an admin" cannot be pressed and the reason is read with it',
    async (query, leave, reason) => {
      const body = await flat(await open(`/@kanagawapm/edit${query}`))
      const button = leaveButton(body, leave)
      expect(button).toMatch(/\bdisabled\b/)
      const described = /aria-describedby="([^"]+)"/.exec(button)?.[1]
      expect(described).toBeTruthy()
      expect(body).toMatch(
        new RegExp(`<p [^>]*id="${described}"[^>]*> ${reason} </p>`),
      )
    },
  )

  test('F30-AC52: Given two admins, When the editing page is drawn, Then "stop being an admin" can be pressed and no reason shows', async () => {
    await post(`/communities/${ID}/admins`, [['handle', 'bob']])
    const body = await flat(await open('/@kanagawapm/edit'))
    const button = leaveButton(body, '管理者から外れる')
    expect(button).toContain('<button')
    expect(button).not.toMatch(/\bdisabled\b/)
    expect(button).not.toContain('aria-describedby')
    expect(body).not.toContain('最後の管理者は外れられません。')
  })

  test('F30-AC28: Given two admins removing each other at once, When both are sent, Then one stays', async () => {
    await post(`/communities/${ID}/admins`, [['handle', 'bob']])
    const results = await Promise.all([
      removeCommunityAdmin(db, { communityId: ID, userId: BOB }),
      removeCommunityAdmin(db, { communityId: ID, userId: OWNER_ID }),
    ])
    expect(results.sort()).toEqual(['last', 'removed'])
    expect(await admins()).toHaveLength(1)
  })

  test('F30-AC28: Given two admins of whom one left the service, When the other leaves, Then they stay as the last admin with a handle; the one who left may be removed', async () => {
    await post(`/communities/${ID}/admins`, [['handle', 'bob']])
    await markAccountDeleted(db, { ownerUserId: BOB, now: 10 })
    const response = await post(
      `/communities/${ID}/admins/${OWNER_ID}/remove`,
      [],
    )
    expect(response.headers.get('Location')).toBe(
      '/@kanagawapm/edit?notice=admin-last',
    )
    expect(await admins()).toEqual([BOB, OWNER_ID].sort())
    expect(
      await removeCommunityAdmin(db, { communityId: ID, userId: BOB }),
    ).toBe('removed')
    expect(await admins()).toEqual([OWNER_ID])
  })

  test('F30-AC27: Given a handle typed with capitals, When it is added, Then the person it names is added', async () => {
    const response = await post(`/communities/${ID}/admins`, [
      ['handle', '@Bob'],
    ])
    expect(response.headers.get('Location')).toBe(
      '/@kanagawapm/edit?notice=admin-added',
    )
    expect(await admins()).toEqual([BOB, OWNER_ID].sort())
  })

  test.each([
    ['not an admin', () => bob],
    ['signed out', () => ''],
  ])(
    'F30-AC70: Given someone %s, When they send the admin and deletion forms, Then each is refused and nothing changes',
    async (_who, cookieOf) => {
      const cookie = cookieOf()
      expect(
        (await post(`/communities/${ID}/admins`, [['handle', 'bob']], cookie))
          .status,
      ).toBe(404)
      expect(
        (await post(`/communities/${ID}/admins/${OWNER_ID}/remove`, [], cookie))
          .status,
      ).toBe(404)
      expect(
        (
          await post(
            `/communities/${ID}/delete`,
            [['confirm', 'kanagawapm']],
            cookie,
          )
        ).status,
      ).toBe(404)
      expect(await admins()).toEqual([OWNER_ID])
      expect(await orm.select().from(communities)).toHaveLength(1)
    },
  )
})

describe('deleting', () => {
  test.each(['', 'kanagawa', 'KANAGAWAPM', 'kanagawapm2'])(
    'F30-AC32: Given the typed handle %j that does not match, When the deletion is sent, Then the service refuses it and nothing is deleted',
    async (confirm) => {
      const response = await post(`/communities/${ID}/delete`, [
        ['confirm', confirm],
      ])
      expect(response.status).toBe(400)
      expect(await flat(response)).toContain('入力したハンドルが一致しません。')
      expect(await orm.select().from(communities)).toHaveLength(1)
    },
  )

  test('F30-AC32: Given the editing page, When it is drawn, Then "delete" starts disabled and knows the handle it waits for', async () => {
    const body = await flat(await open('/@kanagawapm/edit'))
    expect(body).toMatch(/data-confirm-match="kanagawapm"/)
    expect(body).toMatch(
      /<button class="button-danger" type="submit" disabled data-confirm-button/,
    )
  })

  test('F30-AC71: F30-AC8: Given a community with talks and pictures, When it is deleted, Then its page is not found, its links, admins and pictures go, its handle is held, slides, related links and the event page stay, and the page of a link only the community showed is not found', async () => {
    await seedPublic(db, 'talk', 100, 'Talk')
    await seedTalkLink(db, {
      deckId: 'talk',
      url: 'https://kanagawapm.connpass.com/event/410635/',
    })
    // A link that is no event, on one author's slide: only the community
    // shows its page (F45-AC4).
    const links = checkCommunityLinks([
      'https://kanagawapm.connpass.com/',
      'https://example.com/',
    ])
    if (!links.ok) throw new Error('bad links')
    await replaceCommunityLinks(db, { communityId: ID, ...links, now: 2000 })
    await seedTalkLink(db, {
      deckId: 'talk',
      url: 'https://example.com/post',
      kind: 'article',
    })
    expect((await open('/link/example.com/post', '')).status).toBe(200)
    const form = new FormData()
    form.append(
      'image',
      new File([new Uint8Array(png(256, 256))], 'l.png', { type: 'image/png' }),
    )
    await server.fetch(
      new Request(`${TEST_ORIGIN}/communities/${ID}/logo`, {
        method: 'POST',
        headers: { Cookie: owner, Origin: TEST_ORIGIN },
        body: form,
      }),
      env,
    )
    expect(await bucket.get(imageKey(ID, 'logo'))).not.toBeNull()
    const response = await post(`/communities/${ID}/delete`, [
      ['confirm', 'kanagawapm'],
    ])
    expect(response.status).toBe(303)
    expect((await open('/@kanagawapm', '')).status).toBe(404)
    expect(await orm.select().from(communities)).toEqual([])
    expect(await orm.select().from(communityLinks)).toEqual([])
    expect(await orm.select().from(communityAdmins)).toEqual([])
    expect(await bucket.get(imageKey(ID, 'logo'))).toBeNull()
    expect(
      await orm.select().from(handles).where(eq(handles.handle, 'kanagawapm')),
    ).toEqual([])
    expect(
      await orm
        .select()
        .from(releasedHandles)
        .where(eq(releasedHandles.handle, 'kanagawapm')),
    ).toHaveLength(1)
    const now = Math.floor(Date.now() / 1000)
    expect(await handleAvailability(db, 'kanagawapm' as Handle, now)).toBe(
      'held',
    )
    expect(
      await handleAvailability(
        db,
        'kanagawapm' as Handle,
        now + HANDLE_HOLD_SECONDS + 1,
      ),
    ).toBe('available')
    expect(await orm.select().from(relatedLinks)).toHaveLength(2)
    // An event keeps its page with one slide (F45-AC3); the other link's
    // page is the one of an address nobody gathered (F45-AC40).
    expect((await open('/link/connpass.com/event/410635', '')).status).toBe(200)
    const gone = await open('/link/example.com/post', '')
    expect(gone.status).toBe(404)
    expect(await gone.text()).toContain('この URL の集まりは、まだありません')
    expect((await open('/@owner/talk', '')).status).not.toBe(404)
  })
})
