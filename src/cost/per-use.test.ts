import { writeFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { follows, communityFollows } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { placeFiles, publish, type TestFiles } from '../exports/test-upload'
import { PAGE_SCRIPT_PATH } from '../pages/script'
import { serveStoredFile } from '../preview/stored-file-store'
import {
  OWNER_ID,
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
// @ts-expect-error -- a plain ES module without type declarations
import { PER_USE } from '../../scripts/cost/per-use.mjs'
import { counting, type Usage } from './test-counting'
import { LARGE_DATASET, seedDataset } from './test-dataset'

/**
 * What one use of the service takes from the bill, counted on the local run
 * (docs/dev/scale-cost.md, COST-AC8 to COST-AC10). Worker requests, R2
 * operations and D1 queries come from the code and do not depend on the
 * machine. R2 reads are counted as the internal cache missing, the most the
 * code can ask of R2; the cost formula applies the share that hits.
 *
 * Set COST_REPORT_FILE to write the measured numbers as JSON.
 */

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
await applyMigrations(database)
afterAll(() => platform.dispose())

const SIZES = { small: 5, normal: 30, large: 100 } as const
type Size = keyof typeof SIZES

const baseEnv = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  UPLOAD_LIMITS: { activeSessions: 20, startsPerDay: 1000, files: 500 },
} as unknown as Env

const versionOf = (files: number): TestFiles => ({
  'index.html': '<!doctype html><title>Talk</title><h1>Talk</h1>',
  ...Object.fromEntries(
    Array.from({ length: files - 1 }, (_, i) => [
      `assets/part-${i}.js`,
      `export const part = ${i}\n`,
    ]),
  ),
})

const counted = counting(baseEnv)
afterAll(() => counted.restore())
const { usage } = counted

/** The cached entrypoints of the Worker, as `ctx.exports` offers them. */
const context = {
  waitUntil() {},
  passThroughOnException() {},
  exports: {
    ContentFiles: {
      fetch(request: Request) {
        usage.internalRequests++
        return serveStoredFile(counted.env.UPLOADS, request)
      },
    },
    CoverShots: {
      // A cover the cache already holds: no browser starts.
      async fetch() {
        usage.internalRequests++
        return new Response('jpeg', { headers: { 'Cf-Cache-Status': 'HIT' } })
      },
    },
  },
} as unknown as ExecutionContext

const requests = vi.spyOn(server, 'fetch')
const get = (url: string, headers: HeadersInit = {}) =>
  server.fetch(new Request(url, { headers }), counted.env, context)

type Measured = Usage & { cpuMs: number }

/** Runs the steps with the counters at zero; the CPU time is this process's. */
async function measure(steps: () => Promise<void>): Promise<Measured> {
  counted.reset()
  requests.mockClear()
  const before = process.cpuUsage()
  await steps()
  const cpu = process.cpuUsage(before)
  return {
    ...usage,
    workerRequests: requests.mock.calls.length,
    cpuMs: Math.round((cpu.user + cpu.system) / 1000),
  }
}

async function drain(response: Response) {
  await response.arrayBuffer()
  return response
}

const measured: Record<string, Measured> = {}

type Counts = Record<
  | 'workerRequests'
  | 'internalRequests'
  | 'd1Queries'
  | 'd1RowsRead'
  | 'd1RowsWritten'
  | 'r2ClassA'
  | 'r2ClassB',
  number
>

/**
 * The counts of scripts/cost/per-use.mjs, which the cost formula starts
 * from, still describe the code. Requests, R2 operations and rows written
 * follow from the code and must match; rows read depend on the data and
 * may move 10% before the file needs rewriting from the report.
 */
function expectDefaults(name: string, expected: Counts) {
  const found = measured[name]!
  for (const key of [
    'workerRequests',
    'internalRequests',
    'd1Queries',
    'd1RowsWritten',
    'r2ClassA',
    'r2ClassB',
  ] as const)
    expect(found[key], `${name}.${key}`).toBe(expected[key])
  expect(found.d1RowsRead, `${name}.d1RowsRead`).toBeGreaterThanOrEqual(
    expected.d1RowsRead * 0.9,
  )
  expect(found.d1RowsRead, `${name}.d1RowsRead`).toBeLessThanOrEqual(
    expected.d1RowsRead * 1.1,
  )
}
const deployments: Record<Size, { id: string; slug: string; paths: string[] }> =
  {} as never
let member = ''
let bytesPerSlide = 0

beforeAll(async () => {
  await resetTables(database)
  member = await signIn(baseEnv, 'alice')
  await seedDataset(database, LARGE_DATASET)
  const orm = drizzle(database)
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

describe('what the data weighs', () => {
  it('COST-AC10: Given 10,000 slides, When the database is measured, Then its size for each slide is reported', async () => {
    // D1 reports the size of the database in the metadata of every answer.
    const { meta } = await database.prepare('SELECT 1').all()
    bytesPerSlide = Math.round(meta.size_after / LARGE_DATASET.slides)
    expect(bytesPerSlide).toBeGreaterThan(0)
  })
})

describe('putting a slide up', () => {
  for (const size of Object.keys(SIZES) as Size[])
    it(`COST-AC8: Given a version of ${SIZES[size]} files, When it is put up, Then the requests, R2 writes and D1 rows are counted`, async () => {
      const files = versionOf(SIZES[size])
      let placed = { deploymentId: '', slug: '' }
      measured[`upload-${size}`] = await measure(async () => {
        placed = await placeFiles(counted.env, member, files)
      })
      await publish(database, placed.slug, placed.deploymentId)
      deployments[size] = {
        id: placed.deploymentId,
        slug: placed.slug,
        paths: Object.keys(files),
      }
      const upload = measured[`upload-${size}`]!
      // Start, one request for each file, finalize.
      expect(upload.workerRequests).toBe(SIZES[size] + 2)
      // One object for each file, and nothing else is written to R2.
      expect(upload.r2ClassA).toBe(SIZES[size])
      expect(upload.fetches).toBe(0)
      expectDefaults(`upload-${size}`, PER_USE[size].upload)
    }, 120_000)
})

describe('opening a slide', () => {
  for (const size of Object.keys(SIZES) as Size[])
    it(`COST-AC9: Given a version of ${SIZES[size]} files, When a reader opens it, Then the page, the session, every file and the page script are counted`, async () => {
      const { id, slug, paths } = deployments[size]
      const origin = `https://d-${id}.content.example`
      const etags = new Map<string, string>()
      measured[`view-${size}`] = await measure(async () => {
        await drain(await get(`${TEST_ORIGIN}/@alice/${slug}`))
        await drain(await get(`${TEST_ORIGIN}/api/session`))
        for (const path of paths) {
          const response = await drain(
            await get(`${origin}/${path === 'index.html' ? '' : path}`),
          )
          expect(response.status).toBe(200)
          etags.set(path, response.headers.get('ETag') ?? '')
        }
        await drain(await get(`${origin}${PAGE_SCRIPT_PATH}`))
      })
      const view = measured[`view-${size}`]!
      // The page, the session, each file, the page script.
      expect(view.workerRequests).toBe(SIZES[size] + 3)
      // Each file goes through the cached entrypoint.
      expect(view.internalRequests).toBe(SIZES[size])
      expect(view.r2ClassB).toBe(SIZES[size])
      expect(view.r2ClassA).toBe(0)
      expect(view.d1RowsWritten).toBe(0)
      expect(view.fetches).toBe(0)
      expectDefaults(`view-${size}`, PER_USE[size].view)

      measured[`revisit-${size}`] = await measure(async () => {
        await drain(await get(`${TEST_ORIGIN}/@alice/${slug}`))
        await drain(await get(`${TEST_ORIGIN}/api/session`))
        for (const path of paths) {
          const response = await drain(
            await get(`${origin}/${path === 'index.html' ? '' : path}`, {
              'If-None-Match': etags.get(path) ?? '',
            }),
          )
          expect(response.status).toBe(304)
        }
        await drain(await get(`${origin}${PAGE_SCRIPT_PATH}`))
      })
      const revisit = measured[`revisit-${size}`]!
      // A browser that holds the files asks again and is told nothing
      // changed: no stored byte is read.
      expect(revisit.internalRequests).toBe(0)
      expect(revisit.r2ClassB).toBe(0)
      expect(revisit.d1Queries).toBeGreaterThan(0)
      expectDefaults(`revisit-${size}`, PER_USE[size].revisit)
    }, 120_000)

  it('COST-AC9: Given a public slide, When its cover is asked for, Then one request, one internal call and one D1 query are counted', async () => {
    const { id } = deployments.normal
    measured.cover = await measure(async () => {
      const response = await drain(await get(`${TEST_ORIGIN}/covers/${id}.jpg`))
      expect(response.status).toBe(200)
    })
    expect(measured.cover.workerRequests).toBe(1)
    expect(measured.cover.internalRequests).toBe(1)
    expect(measured.cover.r2ClassB).toBe(0)
    expectDefaults('cover', PER_USE.cover)
  }, 120_000)
})

describe('listing slides', () => {
  it('COST-AC10: Given 10,000 slides, When a visitor opens the top page, Then its requests and D1 rows are counted', async () => {
    measured['list-top-visitor'] = await measure(async () => {
      for (const path of ['/', '/api/session', '/api/public/slides'])
        await drain(await get(`${TEST_ORIGIN}${path}`))
    })
    expect(measured['list-top-visitor'].workerRequests).toBe(3)
    expectDefaults('list-top-visitor', PER_USE.list.topVisitor)
  }, 120_000)

  it('COST-AC10: Given 10,000 slides, When a member opens the top page, Then its requests and D1 rows are counted', async () => {
    measured['list-top-member'] = await measure(async () => {
      for (const path of [
        '/',
        '/api/session',
        '/api/public/slides',
        '/api/home',
        '/api/home/communities',
      ])
        await drain(await get(`${TEST_ORIGIN}${path}`, { Cookie: member }))
    })
    expect(measured['list-top-member'].workerRequests).toBe(5)
    expectDefaults('list-top-member', PER_USE.list.topMember)
  }, 120_000)

  it('COST-AC10: Given 10,000 slides, When a profile and a community page are opened, Then their requests and D1 rows are counted', async () => {
    measured['list-profile'] = await measure(async () => {
      expect((await drain(await get(`${TEST_ORIGIN}/@p1`))).status).toBe(200)
    })
    measured['list-community'] = await measure(async () => {
      expect((await drain(await get(`${TEST_ORIGIN}/@c1`))).status).toBe(200)
    })
    expectDefaults('list-profile', PER_USE.list.profile)
    expectDefaults('list-community', PER_USE.list.community)
  }, 120_000)
})

afterAll(() => {
  const file = process.env.COST_REPORT_FILE
  if (file)
    writeFileSync(file, JSON.stringify({ ...measured, bytesPerSlide }, null, 2))
})
