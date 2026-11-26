import { readFileSync, writeFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { communityFollows, follows } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { placeFiles, publish } from '../exports/test-upload'
import {
  OWNER_ID,
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { counting } from './test-counting'
import { LARGE_DATASET, seedDataset } from './test-dataset'

/**
 * The indexes this work added (docs/dev/scale-cost.md, COST-AC6 and
 * COST-AC7): for each, the rows a screen's query reads on the data of
 * src/cost/test-dataset.ts without it and with it, the plan, and that the
 * answers are the same. The index is dropped, measured, and created again
 * from the text of its migration, so the migration itself is what is tested.
 *
 * Set COST_REPORT_FILE to write the numbers as JSON.
 */

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
await applyMigrations(database)
afterAll(() => platform.dispose())

const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  UPLOAD_LIMITS: { activeSessions: 20, startsPerDay: 1000, files: 500 },
} as unknown as Env
const counted = counting(env)
afterAll(() => counted.restore())

type Target = Readonly<{
  /** The screen, as the report names it. */
  screen: string
  path: string
  signedIn: boolean
  /** Names the statement the index is for. */
  statement: string
}>

type Added = Readonly<{
  index: string
  migration: string
  targets: readonly Target[]
}>

const LIST = 'order by "deployments"."ready_at"'
const ADDED: readonly Added[] = [
  {
    index: 'deployments_ready_at',
    migration: 'migrations/0066_deployments_ready_at.sql',
    targets: [
      {
        screen: 'top page, a visitor (/api/public/slides)',
        path: '/api/public/slides',
        signedIn: false,
        statement: LIST,
      },
      {
        screen: 'top page, a member (/api/public/slides)',
        path: '/api/public/slides',
        signedIn: true,
        statement: LIST,
      },
      {
        screen: 'top page, the people a member follows (/api/home)',
        path: '/api/home',
        signedIn: true,
        statement: LIST,
      },
    ],
  },
]

let member = ''
beforeAll(async () => {
  await resetTables(database)
  member = await signIn(env, 'alice')
  await seedDataset(database, LARGE_DATASET)
  const orm = drizzle(database)
  // The newest slides are of the first people, so a member who follows them
  // finds the first matches near the top of the list.
  await orm.insert(follows).values(
    Array.from({ length: 20 }, (_, i) => ({
      follower_user_id: OWNER_ID,
      followee_user_id: `u${i + 1}`,
      created_at: 1,
    })),
  )
  await orm.insert(communityFollows).values(
    [1, 2, 3].map((id) => ({
      user_id: OWNER_ID,
      community_id: id,
      created_at: 1,
    })),
  )
}, 120_000)

type Reading = { rows: number; statementRows: number; body: string }

/** Opens the screen's path; the rows read by it and by its listing statement. */
async function read(target: Target): Promise<Reading> {
  counted.reset()
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}${target.path}`, {
      headers: target.signedIn ? { Cookie: member } : {},
    }),
    counted.env,
  )
  expect(response.status).toBe(200)
  const body = await response.text()
  const statement = counted.log.find((row) =>
    row.sql.includes(target.statement),
  )
  expect(statement, `${target.screen} runs its listing statement`).toBeDefined()
  return {
    rows: counted.usage.d1RowsRead,
    statementRows: statement!.rowsRead,
    body,
  }
}

async function planOf(target: Target): Promise<string[]> {
  const statement = counted.log.find((row) =>
    row.sql.includes(target.statement),
  )!
  const plan = await database
    .prepare(`EXPLAIN QUERY PLAN ${statement.sql}`)
    .bind(...(statement.params as unknown[]))
    .all()
  return plan.results.map((row) => String(Object.values(row).at(-1)))
}

const report: Record<string, unknown> = {}

describe('the indexes added for the rows a screen reads', () => {
  for (const added of ADDED)
    describe(added.index, () => {
      const sql = readFileSync(added.migration, 'utf8')
      const create = sql
        .split('\n')
        .filter((line) => !line.startsWith('--'))
        .join('\n')

      it(`COST-AC6: Given the migration of ${added.index}, When it is read, Then it only adds the index`, () => {
        expect(create.trim()).toMatch(
          new RegExp(`^CREATE INDEX ${added.index} ON \\w+ \\([^)]*\\);$`),
        )
      })

      it(`COST-AC6: Given 10,000 slides, When the screens that list the newest are read without and with ${added.index}, Then each reads fewer rows and plans through the index`, async () => {
        await database.exec(`DROP INDEX ${added.index}`)
        const before = new Map<Target, Reading>()
        for (const target of added.targets)
          before.set(target, await read(target))
        await database.exec(create.replaceAll('\n', ' '))
        const rows = []
        for (const target of added.targets) {
          const without = before.get(target)!
          const withIndex = await read(target)
          const plan = await planOf(target)
          rows.push({
            screen: target.screen,
            rowsBefore: without.rows,
            rowsAfter: withIndex.rows,
            listingBefore: without.statementRows,
            listingAfter: withIndex.statementRows,
            plan,
          })
          expect(withIndex.statementRows).toBeLessThan(without.statementRows)
          expect(withIndex.rows).toBeLessThan(without.rows)
          expect(plan.join(' ')).toContain(added.index)
          // COST-AC7: the answer is the same with the index.
          expect(withIndex.body).toBe(without.body)
        }
        report[added.index] = rows
      }, 120_000)

      it(`COST-AC7: Given a slide put up and opened, When the rows are counted without and with ${added.index}, Then neither reads more rows and the upload writes only a few more`, async () => {
        const uploadAndOpen = async () => {
          counted.reset()
          const placed = await placeFiles(counted.env, member, {
            'index.html': '<!doctype html><title>T</title>',
            'a.js': 'export {}',
          })
          const upload = { ...counted.usage }
          await publish(database, placed.slug, placed.deploymentId)
          counted.reset()
          const response = await server.fetch(
            new Request(`${TEST_ORIGIN}/@alice/${placed.slug}`),
            counted.env,
          )
          expect(response.status).toBe(200)
          await response.arrayBuffer()
          return {
            uploadRead: upload.d1RowsRead,
            uploadWritten: upload.d1RowsWritten,
            viewRead: counted.usage.d1RowsRead,
          }
        }
        await database.exec(`DROP INDEX ${added.index}`)
        const without = await uploadAndOpen()
        await database.exec(create.replaceAll('\n', ' '))
        const withIndex = await uploadAndOpen()
        report[`${added.index} upload and view`] = { without, withIndex }
        // An index that a query on the state alone chooses makes it read the
        // whole table (20,000 rows here); the margin is for the rows a
        // second slide adds.
        expect(withIndex.uploadRead).toBeLessThanOrEqual(
          without.uploadRead + 300,
        )
        expect(withIndex.viewRead).toBeLessThanOrEqual(without.viewRead + 300)
        expect(
          withIndex.uploadWritten - without.uploadWritten,
        ).toBeGreaterThanOrEqual(0)
        expect(
          withIndex.uploadWritten - without.uploadWritten,
        ).toBeLessThanOrEqual(4)
      }, 120_000)
    })
})

afterAll(() => {
  const file = process.env.COST_REPORT_FILE
  if (file) writeFileSync(file, JSON.stringify(report, null, 2))
})
