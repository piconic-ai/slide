import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { addInvite } from '../auth/invites-store'
import {
  authAccount,
  authSession,
  authUser,
  authVerification,
} from '../db/auth-schema'
import type { EmailAddress } from '../mail/address'
import { readOutbox } from '../mail/outbox-store'
import {
  accounts,
  handles,
  releasedHandles,
  articleCitations,
  articles,
  citations,
  relatedLinks,
  contentSessions,
  decks,
  deployments,
  follows,
  invitedEmails,
  loginCodeRequests,
  mailOutbox,
  mutes,
  notificationOptOuts,
  notifications,
  previewLaunches,
  pictureRemovals,
  profileLinks,
  profilePictures,
  profiles,
  reports,
  suspensions,
  uploadFiles,
} from '../db/schema'
import server from '../app/routes'

export const TEST_ORIGIN = 'https://slide.example'
export const OWNER_ID = '722500'
/** A second person, an author only where a test registers them. */
export const INVITED_ID = '1234'

/** Every person `signIn` makes is invited, so this changes nothing now. */
export const withInvited = (env: Env): Env => env

/** Test configuration for the management origin with owner login enabled. */
export function testEnv(platformEnv: Env): Env {
  return {
    ...platformEnv,
    // Codes are written to the outbox, and the limits stay out of the way.
    MAIL_OUTBOX: 'on',
    LOGIN_CODE_LIMITS: {
      perAddress: 1000,
      perSource: 1000,
      attemptsPerAddress: 1000,
    },
    BETTER_AUTH_SECRET: 'test-only-better-auth-secret-32-bytes-long',
    PUBLIC_ORIGIN: TEST_ORIGIN,
    BROWSER: { shoot: async () => stubCover() },
  } as unknown as Env
}

// A red 2×1 PNG; browsers draw it whatever type it is sent under.
const STUB_COVER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
)
/** Stands in for a cover a browser would take; no test starts a browser. */
const stubCover = () =>
  new Response(STUB_COVER, { headers: { 'Content-Type': 'image/jpeg' } })

export const emailOf = (login: string) => `${login}@mail.example`

/** The newest 6-digit code written for an address, or '' when none was. */
export async function lastCode(db: D1Database, to: string): Promise<string> {
  const [mail] = await readOutbox(db, to)
  return (
    /\b(\d{6})\b/.exec(`${mail?.subject ?? ''} ${mail?.body ?? ''}`)?.[1] ?? ''
  )
}

/**
 * Leaves invited only the people with these user ids, as if the operator had
 * taken the rest off the list. People who signed in are found by their id.
 */
export async function keepInvited(db: D1Database, ids: readonly string[]) {
  const orm = drizzle(db)
  const kept = ids.length
    ? sql`(${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql`('')`
  await orm.run(sql`DELETE FROM invited_emails WHERE email IN
    (SELECT lower(email) FROM auth_user WHERE id NOT IN ${kept})`)
}

/** A person who signed in before and is invited, without going through login. */
export async function seedPerson(db: D1Database, id: string, login = id) {
  const email = emailOf(login)
  await invite(db, email)
  await drizzle(db)
    .insert(authUser)
    .values({
      id,
      name: '',
      email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
}

/** Invites an address, as the operator does. */
export const invite = (db: D1Database, email: string) =>
  addInvite(db, {
    email: email as EmailAddress,
    invitedBy: 'test@operator.example',
    now: 1,
  })

/**
 * Signs in through the login page, reading the code from the outbox; returns
 * the cookie, empty when the sign-in was refused. The person's address is
 * `<login>@mail.example`, and `id` is the user id they get, the first
 * author's by default. They are invited and have their handle (the login,
 * lowercased, or `handle`) unless the options say otherwise.
 */
export async function signIn(
  env: Env,
  login = 'owner',
  person: {
    id?: string
    /** Leave the address off the invitations. */
    invited?: boolean
    /** Stop short of the welcome page: no handle, no display name. */
    welcomed?: boolean
    /** Their handle, when it is not the login (a held one, say). */
    handle?: string
    /** The display name; giving one gives the person a profile. */
    name?: string
    bio?: string
    location?: string
    website?: string
  } = {},
): Promise<string> {
  const db = env.DB
  const orm = drizzle(db)
  const email = emailOf(login)
  const id = person.id ?? OWNER_ID
  if (person.invited !== false) await invite(db, email)
  await orm
    .insert(authUser)
    .values({
      id,
      name: '',
      email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
  if (person.welcomed !== false) {
    await orm
      .insert(accounts)
      .values({
        user_id: id,
        handle: person.handle ?? login.toLowerCase(),
        created_at: 1,
      })
      .onConflictDoNothing()
    // A profile only where a test asks for one; most pages work without.
    if (person.name !== undefined)
      await orm
        .insert(profiles)
        .values({
          user_id: id,
          name: person.name,
          bio: person.bio ?? null,
          location: person.location ?? null,
          website: person.website ?? null,
        })
        .onConflictDoNothing()
  }
  const asked = await server.fetch(
    new Request(`${TEST_ORIGIN}/login`, {
      method: 'POST',
      headers: {
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ email }).toString(),
    }),
    env,
  )
  await asked.text()
  const code = await lastCode(db, email)
  if (!code) return ''
  const entered = await server.fetch(
    new Request(`${TEST_ORIGIN}/login/code`, {
      method: 'POST',
      headers: {
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ email, code }).toString(),
    }),
    env,
  )
  return (
    entered.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('__Host-slide_owner='))
      ?.split(';')[0] ?? ''
  )
}

/** Clears the tables that publication tests use. */
export async function resetTables(db: D1Database) {
  const orm = drizzle(db)
  // Decks and deployments reference each other, so pointers go first.
  await orm.batch([
    orm
      .update(decks)
      .set({ public_deployment_id: null, resume_deployment_id: null }),
    ...[
      articleCitations,
      articles,
      citations,
      relatedLinks,
      reports,
      suspensions,
      follows,
      mutes,
      notificationOptOuts,
      notifications,
      contentSessions,
      previewLaunches,
      uploadFiles,
      deployments,
      decks,
      authSession,
      authAccount,
      authUser,
      authVerification,
      accounts,
      handles,
      releasedHandles,
      profiles,
      profileLinks,
      profilePictures,
      pictureRemovals,
      invitedEmails,
      loginCodeRequests,
      mailOutbox,
    ].map((table) => orm.delete(table)),
  ])
}

/** Inserts a deck; its slug is its id unless the test names another. */
export async function seedDeck(
  db: D1Database,
  id: string,
  owner = OWNER_ID,
  slug = id,
) {
  // Historical migration tests also use this fixture before newer columns exist.
  await drizzle(db)
    .run(sql`INSERT INTO decks (id, slug, owner_user_id, created_at)
    VALUES (${id}, ${slug}, ${owner}, 1)`)
}

/**
 * Inserts a deployment of the deck in the given upload state. Historical
 * migration tests also use this fixture on a schema from before 0029, where
 * a deployment still names the workflow that sent it.
 */
export async function seedDeployment(
  db: D1Database,
  deck: string,
  state: 'uploading' | 'ready' | 'failed' | 'expired' = 'ready',
) {
  const id = crypto.randomUUID()
  const orm = drizzle(db)
  const readyAt = state === 'ready' ? 1 : null
  const failureReason = state === 'failed' ? 'author_bytes_exceeded' : null
  const beforeSource = await orm.get(
    sql`SELECT 1 FROM pragma_table_info('deployments') WHERE name = 'source_sha'`,
  )
  if (beforeSource) {
    await orm.run(sql`INSERT INTO deployments
      (id, idempotency_key, inventory_digest, source_sha, run_id, run_attempt,
       actor_id, repository_id, owner_id, source_ref, state, total_bytes,
       token_hash, created_at, expires_at, credential_expires_at, ready_at,
       failure_reason, deck_id)
      VALUES (${id}, ${`key-${id}`}, 'g', ${'b'.repeat(40)}, '7', '1',
        ${OWNER_ID}, '1', '2', 'refs/heads/main', ${state}, 1, 'h', 1, 2, 2,
        ${readyAt}, ${failureReason}, ${deck})`)
    return id
  }
  await orm.insert(deployments).values({
    id,
    idempotency_key: `key-${id}`,
    inventory_digest: 'g',
    source: 'browser',
    state,
    total_bytes: 1,
    token_hash: 'h',
    created_at: 1,
    expires_at: 2,
    credential_expires_at: 2,
    ready_at: readyAt,
    failure_reason: failureReason,
    deck_id: deck,
  })
  return id
}

/** A deck whose public pointer names a ready deployment of the given age. */
export async function seedPublic(
  db: D1Database,
  deck: string,
  readyAt: number,
  title: string | null,
  ownerId = OWNER_ID,
  slug = deck,
) {
  const orm = drizzle(db)
  await seedDeck(db, deck, ownerId, slug)
  const id = await seedDeployment(db, deck)
  await orm.batch([
    orm
      .update(deployments)
      .set({ ready_at: readyAt, title })
      .where(eq(deployments.id, id)),
    orm
      .update(decks)
      .set({ public_deployment_id: id, first_published_at: readyAt })
      .where(eq(decks.id, deck)),
  ])
  return id
}

/**
 * The launch a signed-in author's viewer holds for slides that are not
 * public: where its form posts, and the one-time token. Read from the
 * viewer page at `path` (`/@owner/talk?v=<version>`).
 */
export async function viewerLaunch(env: Env, cookie: string, path: string) {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, { headers: { Cookie: cookie } }),
    env,
  )
  const page = await response.text()
  const action = /<form[^>]*?action="([^"]+)"[^>]*?data-launch/.exec(page)?.[1]
  const token = /name="token" value="([^"]+)"/.exec(page)?.[1]
  return {
    status: response.status,
    page,
    action: (action ?? '').replaceAll('&amp;', '&'),
    token: token ?? '',
  }
}

/** The post the viewer's form makes, into its frame. */
export const postFrameLaunch = (env: Env, action: string, token: string) =>
  server.fetch(
    new Request(action, {
      method: 'POST',
      headers: {
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Sec-Fetch-Dest': 'iframe',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
      },
      body: new URLSearchParams({ token }).toString(),
    }),
    env,
  )

/**
 * Opens the author's viewing session of slides that are not public, as the
 * viewer's frame does; returns its cookie as `name=value`, or an empty
 * string when none opened.
 */
export async function openOwnerSession(env: Env, cookie: string, path: string) {
  const { action, token } = await viewerLaunch(env, cookie, path)
  if (!action) return ''
  const launched = await postFrameLaunch(env, action, token)
  return launched.headers.getSetCookie()[0]?.split(';')[0] ?? ''
}
