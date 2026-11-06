import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from '../db/test-migrations'
import { applyAuthorCommand } from './author'
import { readPublication } from './store'
import type { AuthorCommand } from './transitions'
import { OWNER_ID, resetTables, seedDeck, seedDeployment } from './test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
})
afterAll(() => platform.dispose())

/**
 * A database whose first `count` deck updates run `interleave` just before
 * they execute, as if another request committed in between. Updates run
 * alone or in a batch.
 */
function racing(interleave: () => Promise<unknown>, count = 1): D1Database {
  let remaining = count
  // Bound statements that update decks, mapped to the real ones.
  const decksUpdates = new Map<object, D1PreparedStatement>()
  const before = async () => {
    if (remaining-- > 0) await interleave()
  }
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property) {
        if (property === 'bind')
          return (...values: unknown[]) => {
            const bound = target.bind(...values)
            const proxy = new Proxy(bound, {
              get(inner, name) {
                if (name === 'run')
                  return async () => {
                    await before()
                    return inner.run()
                  }
                const value = Reflect.get(inner, name)
                return typeof value === 'function' ? value.bind(inner) : value
              },
            })
            decksUpdates.set(proxy, bound)
            return proxy
          }
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  return new Proxy(db, {
    get(target, property) {
      if (property === 'prepare')
        return (query: string) => {
          const statement = target.prepare(query)
          return /^update "decks"/i.test(query) ? wrap(statement) : statement
        }
      if (property === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          if (statements.some((statement) => decksUpdates.has(statement)))
            await before()
          return target.batch(
            statements.map(
              (statement) => decksUpdates.get(statement) ?? statement,
            ),
          )
        }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

const publishDirectly = (deploymentId: string) =>
  db
    .prepare(
      'UPDATE decks SET public_deployment_id = ?, revision = revision + 1, author_revision = revision + 1',
    )
    .bind(deploymentId)
    .run()

const run = (database: D1Database, command: AuthorCommand, revision = 1) =>
  applyAuthorCommand(database, {
    deckId: 'talk',
    ownerUserId: OWNER_ID,
    command,
    expectedRevision: revision,
    now: 100,
  })

test('Given A is public, When B is published while the pause is being saved, Then the pause still stops B', async () => {
  const a = await seedDeployment(db, 'talk')
  const b = await seedDeployment(db, 'talk')
  await publishDirectly(a)
  const result = await run(
    racing(() => publishDirectly(b)),
    { kind: 'pause' },
  )
  expect(result).toMatchObject({
    kind: 'applied',
    publication: { publication: { kind: 'paused', resumeTo: b } },
  })
  expect((await readPublication(db, 'talk', OWNER_ID))?.publication).toEqual({
    kind: 'paused',
    resumeTo: b,
  })
})

test('Given publications keep landing, When the pause loses every attempt, Then it reports the conflict instead of looping', async () => {
  const a = await seedDeployment(db, 'talk')
  await publishDirectly(a)
  const result = await run(
    racing(() => publishDirectly(a), 3),
    {
      kind: 'pause',
    },
  )
  expect(result.kind).toBe('conflict')
})

test('Given A is public, When another publish lands before B is saved, Then B conflicts and the other result stays', async () => {
  const a = await seedDeployment(db, 'talk')
  const b = await seedDeployment(db, 'talk')
  const c = await seedDeployment(db, 'talk')
  await publishDirectly(a)
  const result = await run(
    racing(() => publishDirectly(c)),
    {
      kind: 'publish',
      deploymentId: b,
    },
  )
  expect(result).toMatchObject({
    kind: 'conflict',
    publication: { publication: { kind: 'public', deploymentId: c } },
  })
})

test('Given B is ready when checked, When it stops being ready before the save, Then it is not published', async () => {
  const b = await seedDeployment(db, 'talk')
  const result = await run(
    racing(() =>
      db
        .prepare(
          "UPDATE deployments SET state = 'expired', ready_at = NULL WHERE id = ?",
        )
        .bind(b)
        .run(),
    ),
    { kind: 'publish', deploymentId: b },
    0,
  )
  expect(result.kind).toBe('not_publishable')
  expect((await readPublication(db, 'talk', OWNER_ID))?.publication).toEqual({
    kind: 'draft',
  })
})

test('Given the public deployment is no longer ready, When paused, Then the pause still applies', async () => {
  const a = await seedDeployment(db, 'talk')
  await publishDirectly(a)
  await db
    .prepare(
      "UPDATE deployments SET state = 'expired', ready_at = NULL WHERE id = ?",
    )
    .bind(a)
    .run()
  expect((await run(db, { kind: 'pause' })).kind).toBe('applied')
})

test('Given a stale view and a foreign deployment, When published, Then the conflict is reported first', async () => {
  await seedDeck(db, 'theirs', '1')
  const foreign = await seedDeployment(db, 'theirs')
  const a = await seedDeployment(db, 'talk')
  await publishDirectly(a)
  expect(
    (await run(db, { kind: 'publish', deploymentId: foreign }, 0)).kind,
  ).toBe('conflict')
})

test('Given a paused deck, When the mode changes, Then the pause time is kept', async () => {
  await run(db, { kind: 'pause' }, 0)
  await db.prepare('UPDATE decks SET paused_at = 50').run()
  await run(db, { kind: 'set_mode', mode: 'repository' })
  expect(
    await db.prepare('SELECT paused_at FROM decks').first('paused_at'),
  ).toBe(50)
})

test('Given the deck changed owner after it was read, When saved, Then nothing is written', async () => {
  const a = await seedDeployment(db, 'talk')
  const result = await run(
    racing(() => db.prepare("UPDATE decks SET owner_user_id = '1'").run()),
    { kind: 'publish', deploymentId: a },
    0,
  )
  expect(result.kind).toBe('not_found')
  expect(
    await db
      .prepare('SELECT public_deployment_id FROM decks')
      .first('public_deployment_id'),
  ).toBeNull()
})

test('Given a publish of B loses to another change, When the batch runs, Then B keeps its owner sessions', async () => {
  const a = await seedDeployment(db, 'talk')
  const b = await seedDeployment(db, 'talk')
  await db
    .prepare(
      "INSERT INTO content_sessions VALUES ('s-b', ?, ?, 1, 9999999999, 9999999999)",
    )
    .bind(b, OWNER_ID)
    .run()
  // The rival reaches the same revision B's publish would have.
  const result = await run(
    racing(() => publishDirectly(a)),
    {
      kind: 'publish',
      deploymentId: b,
    },
    0,
  )
  expect(result.kind).toBe('conflict')
  expect(
    await db.prepare('SELECT COUNT(*) AS n FROM content_sessions').first('n'),
  ).toBe(1)
})
