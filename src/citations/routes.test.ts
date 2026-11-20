import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import {
  accounts,
  citations,
  decks,
  deployments,
  mutes,
  suspensions,
  uploadFiles,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { applyOperatorCommand } from '../publication/takedown-store'
import {
  resetTables,
  seedDeck,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { recordCitations } from './citation-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

const READER_ID = '999'

let owner = ''
let talk = ''
let reply = ''

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  // Signing in records the handle "owner" from the stubbed GitHub login.
  owner = await signIn(env)
  talk = await seedPublic(db, 'talk', 1, 'Talk')
  await orm
    .insert(accounts)
    .values({ user_id: READER_ID, handle: 'reader', created_at: 1 })
  reply = await seedPublic(db, 'reply', 2, 'Reply', READER_ID)
})
afterAll(() => platform.dispose())

const cite = (
  deploymentId: string,
  slug: string,
  page: number,
  handle = 'owner',
) =>
  orm.insert(citations).values({
    deployment_id: deploymentId,
    target_handle: handle,
    target_slug: slug,
    target_page: page,
  })

const open = (path: string, cookie = '', lang = 'ja') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: { Cookie: cookie, 'Accept-Language': lang },
    }),
    env,
  )

/** The share paths of the cards in a piece of a page, in order. */
const cardLinks = (part: string) =>
  [...part.matchAll(/<a class="card-title" href="([^"]+)"/g)].map(
    (match) => match[1],
  )

test('F24-AC18: Given public slides cite the author’s slides, When the author opens the page of those slides, Then it lists no citing slide, in either language, while their viewer still does', async () => {
  await cite(reply, 'talk', 6)
  for (const lang of ['ja', 'en']) {
    const page = await (await open('/slides/talk', owner, lang)).text()
    expect(page).not.toContain('data-deck-frame="cited-by"')
    expect(page).not.toContain('id="cited-by"')
    expect(page).not.toContain('このスライドを引用しているスライド')
    expect(page).not.toContain('Slides citing these slides')
    expect(page).not.toContain('/@reader/reply')
  }
  const viewer = await (await open('/@owner/talk')).text()
  expect(cardLinks(viewer)).toContain('/@reader/reply')
})

/** One of the two places of the viewer's citations, as the page has it. */
const listOf = (page: string, name: 'cites' | 'cited-by') =>
  new RegExp(
    `<div data-reader-lists="${name}">([\\s\\S]*?)</div>\\s*(?:<div data-reader-lists|(?:</div>\\s*)?</main>)`,
  ).exec(page)?.[1] ?? null

const viewerOf = async (path: string, cookie = '', lang = 'ja') =>
  (await open(path, cookie, lang)).text()

const point = (deck: string, deploymentId: string | null) =>
  orm
    .update(decks)
    .set({ public_deployment_id: deploymentId })
    .where(eq(decks.id, deck))

test('F24-AC1, F24-AC2: Given slides whose HTML links to a page of another deck’s share URL, When they are received and published, Then each viewer shows the other deck as a cover card under its heading', async () => {
  await seedDeck(db, 'answer', READER_ID)
  const answer = await seedDeployment(db, 'answer')
  const body = `<a href="${TEST_ORIGIN}/@owner/talk/6">the talk</a>`
  await platform.env.UPLOADS.put(`${answer}/0/lease`, body)
  await orm.insert(uploadFiles).values({
    deployment_id: answer,
    id: '0',
    path: 'index.html',
    size: body.length,
    sha256: 'x',
    media_type: 'text/html; charset=utf-8',
    object_key: `${answer}/0/lease`,
  })
  await recordCitations(env, answer)
  await orm
    .update(deployments)
    .set({ title: 'Answer', ready_at: 9 })
    .where(eq(deployments.id, answer))
  await point('answer', answer)

  const cited = await viewerOf('/@owner/talk')
  const citing = await viewerOf('/@reader/answer')

  const citedBy = listOf(cited, 'cited-by') ?? ''
  expect(citedBy).toContain(
    '<h2 id="cited-by">このスライドを引用しているスライド</h2>',
  )
  expect(cardLinks(citedBy)).toEqual(['/@reader/answer'])
  expect(citedBy).toContain(`src="/covers/${answer}.jpg"`)
  expect(citedBy).toContain('<a href="/@reader">@reader</a>')
  expect(listOf(cited, 'cites')).toBe('')
  const cites = listOf(citing, 'cites') ?? ''
  expect(cites).toContain(
    '<h2 id="cites">このスライドが引用しているスライド</h2>',
  )
  expect(cardLinks(cites)).toEqual(['/@owner/talk'])
  expect(cites).toContain(`src="/covers/${talk}.jpg"`)
  expect(listOf(citing, 'cited-by')).toBe('')
})

test('F24-AC3: Given a deck that links to three pages of another, When the cited deck’s viewer is opened, Then the citing deck is one card', async () => {
  await cite(reply, 'talk', 0)
  await cite(reply, 'talk', 6)
  await cite(reply, 'talk', 24)

  const page = await viewerOf('/@owner/talk')

  expect(cardLinks(page)).toEqual(['/@reader/reply'])
  expect(cardLinks(await viewerOf('/@reader/reply'))).toEqual(['/@owner/talk'])
})

test('F24-AC4: Given a deck that links to itself and to another deck of its author, When its viewer is opened, Then only the other deck is a card', async () => {
  await seedPublic(db, 'sequel', 3, 'Sequel')
  await cite(talk, 'talk', 2)
  await cite(talk, 'sequel', 0)

  const page = await viewerOf('/@owner/talk')

  expect(cardLinks(listOf(page, 'cites') ?? '')).toEqual(['/@owner/sequel'])
  expect(listOf(page, 'cited-by')).toBe('')
})

test('F24-AC5: Given the citing deck stops being public, When the cited deck’s viewer is opened, Then its card is gone, and it is back once the deck is public again', async () => {
  await cite(reply, 'talk', 6)
  await point('reply', null)

  const stopped = await viewerOf('/@owner/talk')

  expect(listOf(stopped, 'cited-by')).toBe('')
  expect(stopped).not.toContain('Reply')

  await point('reply', reply)

  expect(cardLinks(await viewerOf('/@owner/talk'))).toEqual(['/@reader/reply'])
})

test.each([
  [4, null],
  [5, 'ほか 1 件'],
  [7, 'ほか 3 件'],
])(
  'F24-AC6: Given %i decks on each side of the citations, When the viewer is opened, Then the four newest are cards on each side and the rest are counted: %s',
  async (count, more) => {
    for (let index = 0; index < count; index += 1) {
      const slug = `d${index}`
      const id = await seedPublic(db, slug, 10 + index, slug, READER_ID)
      await cite(id, 'talk', 0)
      await cite(talk, slug, 0, 'reader')
    }
    const newest = Array.from(
      { length: 4 },
      (_, index) => `/@reader/d${count - 1 - index}`,
    )

    const page = await viewerOf('/@owner/talk')

    for (const name of ['cites', 'cited-by'] as const) {
      const list = listOf(page, name) ?? ''
      expect(cardLinks(list)).toEqual(newest)
      expect(
        /<p class="citations-more">\s*([^<]*?)\s*<\/p>/.exec(list)?.[1] ?? null,
      ).toBe(more)
    }
  },
)

test('F24-AC6: Given the viewer is read in English, When more decks cite than are shown, Then the headings and the count are in English', async () => {
  for (let index = 0; index < 5; index += 1) {
    const id = await seedPublic(db, `d${index}`, 10 + index, null, READER_ID)
    await cite(id, 'talk', 0)
    await cite(talk, `d${index}`, 0, 'reader')
  }

  const page = await viewerOf('/@owner/talk', '', 'en')

  expect(page).toContain('<h2 id="cites">Slides these slides cite</h2>')
  expect(page).toContain('<h2 id="cited-by">Slides citing these slides</h2>')
  expect(
    page.match(/<p class="citations-more">\s*1 more\s*<\/p>/g),
  ).toHaveLength(2)
})

test('F24-AC7: Given a deck with no citation on either side, When its viewer is opened, Then neither heading shows and both places are empty', async () => {
  const page = await viewerOf('/@owner/talk')

  expect(listOf(page, 'cites')).toBe('')
  expect(listOf(page, 'cited-by')).toBe('')
  expect(page).not.toContain('引用しているスライド')
  expect(page).not.toContain('class="citations"')
})

test('F24-AC8: Given decks on both sides that an operator hid, whose author is suspended, or whose author the reader muted, When the reader opens the viewer, Then none of them is a card or counted, and a reader who muted nobody still sees the muted author’s', async () => {
  const seedSide = async (userId: string, handle: string) => {
    await orm
      .insert(accounts)
      .values({ user_id: userId, handle, created_at: 1 })
    const id = await seedPublic(db, `by-${handle}`, 20, handle, userId)
    await cite(id, 'talk', 0)
    await cite(talk, `by-${handle}`, 0, handle)
  }
  await seedSide('801', 'hidden')
  await seedSide('802', 'suspended')
  await seedSide('803', 'muted')
  await cite(reply, 'talk', 0)
  await cite(talk, 'reply', 0, 'reader')
  await applyOperatorCommand(db, {
    deckId: 'by-hidden',
    command: { kind: 'hide', reason: 'phishing', operator: 'op' },
    now: 5,
  })
  await orm.insert(suspensions).values({
    user_id: '802',
    reason: 'spam',
    suspended_at: 5,
    suspended_by: 'op',
  })
  await orm
    .insert(mutes)
    .values({ muter_user_id: '722500', muted_user_id: '803', created_at: 5 })

  const mine = await viewerOf('/@owner/talk', owner)
  const anonymous = await viewerOf('/@owner/talk')

  for (const name of ['cites', 'cited-by'] as const) {
    expect(cardLinks(listOf(mine, name) ?? '')).toEqual(['/@reader/reply'])
    expect(cardLinks(listOf(anonymous, name) ?? '')).toEqual([
      '/@muted/by-muted',
      '/@reader/reply',
    ])
  }
  expect(mine).not.toContain('class="citations-more"')
  for (const page of [mine, anonymous]) {
    expect(page).not.toContain('by-hidden')
    expect(page).not.toContain('by-suspended')
  }
})

test('F24-AC13: Given a public citing deck that receives a new version with other links, When the viewers are opened, Then the cards stay as they were until the public version is replaced, and then follow the new version', async () => {
  await seedPublic(db, 'other', 3, 'Other')
  await cite(reply, 'talk', 6)
  const next = await seedDeployment(db, 'reply')
  await cite(next, 'other', 0)

  expect(cardLinks(await viewerOf('/@owner/talk'))).toEqual(['/@reader/reply'])
  expect(cardLinks(await viewerOf('/@owner/other'))).toEqual([])
  expect(cardLinks(await viewerOf('/@reader/reply'))).toEqual(['/@owner/talk'])

  await point('reply', next)

  expect(cardLinks(await viewerOf('/@owner/talk'))).toEqual([])
  expect(cardLinks(await viewerOf('/@owner/other'))).toEqual(['/@reader/reply'])
  expect(cardLinks(await viewerOf('/@reader/reply'))).toEqual(['/@owner/other'])
})

test('F24-AC14, F03-AC45: Given decks on both sides of the citations, When the viewer is opened, Then the only frame is the slides themselves, and the policy lets no other deck be framed while their covers may load', async () => {
  await orm
    .update(deployments)
    .set({ cover_path: 'og.png' })
    .where(eq(deployments.id, reply))
  await cite(reply, 'talk', 0)
  await cite(talk, 'reply', 0, 'reader')

  const response = await open('/@owner/talk')
  const page = await response.text()

  expect(page.match(/<iframe\b/g)).toHaveLength(1)
  expect(page).toMatch(
    new RegExp(
      `<iframe\\s[^>]*id="deck"[^>]*src="https://d-${talk}\\.content\\.example/"`,
    ),
  )
  expect(page).not.toContain('data-mini')
  expect(page.match(/<img\s[^>]*data-cover/g)).toHaveLength(2)
  expect(page).toContain(`src="https://d-${reply}.content.example/og.png"`)
  const policy = response.headers.get('Content-Security-Policy') ?? ''
  expect(policy).toContain(
    `frame-src https://d-${talk}.content.example 'self';`,
  )
  expect(policy).toContain(
    "img-src 'self' https://avatars.githubusercontent.com https://*.content.example;",
  )
  expect(policy).toContain("script-src 'self';")
})

test('F24-AC17: Given the cited deck is a draft or its author stopped it, When the citing deck’s viewer is opened, Then no card and no word of the cited deck shows, and the card shows once the cited deck is public', async () => {
  await seedDeck(db, 'secret')
  const secret = await seedDeployment(db, 'secret')
  await orm
    .update(deployments)
    .set({ title: 'Unannounced plans' })
    .where(eq(deployments.id, secret))
  await cite(reply, 'secret', 0)
  await cite(reply, 'talk', 0)
  await point('talk', null)

  const before = await viewerOf('/@reader/reply')

  expect(listOf(before, 'cites')).toBe('')
  expect(before).not.toContain('Unannounced plans')
  expect(before).not.toContain('/@owner/secret')
  expect(before).not.toContain('/@owner/talk')
  expect(before).not.toContain(secret)

  await point('secret', secret)

  const after = await viewerOf('/@reader/reply')
  expect(cardLinks(listOf(after, 'cites') ?? '')).toEqual(['/@owner/secret'])
  expect(after).toContain('Unannounced plans')
})

test.each([
  ['the page of posts', 'GET', '/slides/talk/reactions'],
  ['adding a post', 'POST', '/slides/talk/reactions'],
  ['collecting posts', 'POST', '/slides/talk/reactions/collect'],
  ['removing a post', 'POST', '/slides/talk/reactions/p1/remove'],
])(
  'F24-AC12: Given the author of the slides, signed in or not, When they ask for %s, Then nothing answers there and the slides stay as they were',
  async (_, method, path) => {
    for (const cookie of [owner, '']) {
      const response = await server.fetch(
        new Request(`${TEST_ORIGIN}${path}`, {
          method,
          headers: {
            Cookie: cookie,
            // A browser names the origin on a form post, not on a visit.
            ...(method === 'POST'
              ? {
                  Origin: TEST_ORIGIN,
                  'Content-Type': 'application/x-www-form-urlencoded',
                }
              : {}),
          },
          body:
            method === 'POST'
              ? new URLSearchParams({
                  url: 'https://x.com/kfly8/status/1830000000000000000',
                })
              : undefined,
        }),
        env,
      )

      expect(response.status).toBe(404)
      expect(response.headers.get('location')).toBeNull()
    }
    expect((await open('/slides/talk', owner)).status).toBe(200)
    expect(await viewerOf('/slides/talk', owner)).not.toContain('/reactions')
  },
)
