import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { decks, suspensions, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { readZipDirectory, unpackEntry } from '../drops/zip'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { acquireZipLease } from './lease-store'
import {
  bodyBytes,
  placeFiles,
  publish,
  sha256Hex,
  type TestFiles,
} from './test-upload'

// Each test puts slides up over HTTP; a loaded machine needs more than 5 s.
vi.setConfig({ testTimeout: 30_000 })

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const orm = drizzle(database)
const env = {
  ...testEnv(platform.env),
  UPLOAD_LIMITS: { activeSessions: 20, startsPerDay: 1000, files: 500 },
} as unknown as Env
await applyMigrations(database)
afterAll(() => platform.dispose())

let alice = ''
let bob = ''
beforeEach(async () => {
  await resetTables(database)
  // A test may leave a download unread; its lease is not the next test's.
  const leases = await platform.env.UPLOADS.list({ prefix: 'exports/' })
  await platform.env.UPLOADS.delete(leases.objects.map(({ key }) => key))
  alice = await signIn(env, 'alice')
  bob = await signIn(env, 'bob', { id: INVITED_ID })
}, 30_000)

const PNG = Uint8Array.from({ length: 4000 }, (_, i) => (i * 31 + 7) % 256)
const files: TestFiles = {
  'index.html':
    '<!doctype html><html><head><title>Talk</title></head><body><img src="img/pic.png"><script src="app.js"></script></body></html>',
  'app.js': 'console.log("hello")\n'.repeat(50),
  'css/site.css': 'body { margin: 0 }',
  'img/pic.png': PNG,
  '日本語/資料.html': '<p>こんにちは</p>',
}

const get = (path: string, cookie = alice, headers: HeadersInit = {}) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers },
    }),
    env,
  )
const zipOf = async (response: Response) => {
  const zip = await bodyBytes(response)
  const directory = readZipDirectory(zip)
  if (!directory.ok) throw new Error(`not a zip: ${JSON.stringify(directory)}`)
  return { zip, entries: directory.entries }
}
const contents = async (response: Response) => {
  const { zip, entries } = await zipOf(response)
  return new Map(
    await Promise.all(
      entries.map(
        async (entry) => [entry.path, await unpackEntry(zip, entry)] as const,
      ),
    ),
  )
}
const bytesOf = (value: string | Uint8Array) =>
  typeof value === 'string' ? new TextEncoder().encode(value) : value

describe('the zip of a published version', () => {
  it('F35-AC3, F35-AC7: Given a published slide, When its owner takes the published zip, Then every file has the path and the bytes it was put up with, and nothing else is in it', async () => {
    const placed = await placeFiles(env, alice, files)
    await publish(database, placed.slug, placed.deploymentId)

    const response = await get(`/slides/${placed.slug}/export/published.zip`)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/zip')
    const unpacked = await contents(response)
    expect([...unpacked.keys()].sort()).toEqual(Object.keys(files).sort())
    for (const [path, value] of Object.entries(files))
      expect(unpacked.get(path)).toEqual(bytesOf(value))
    // The page script the service adds when it serves index.html is not there.
    const index = new TextDecoder().decode(unpacked.get('index.html')!)
    expect(index).toBe(files['index.html'])
  })

  it('F35-AC9: Given the zip taken, When it is put up again as it is, Then the new version has the same files with the same SHA-256', async () => {
    const placed = await placeFiles(env, alice, files)
    await publish(database, placed.slug, placed.deploymentId)
    const unpacked = await contents(
      await get(`/slides/${placed.slug}/export/published.zip`),
    )

    const again = await placeFiles(
      env,
      alice,
      Object.fromEntries(unpacked as Map<string, Uint8Array>),
    )

    const shas = async (deploymentId: string) =>
      Object.fromEntries(
        (
          await orm
            .select({ path: uploadFiles.path, sha: uploadFiles.sha256 })
            .from(uploadFiles)
            .where(eq(uploadFiles.deployment_id, deploymentId))
        ).map(({ path, sha }) => [path, sha]),
      )
    expect(await shas(again.deploymentId)).toEqual(
      await shas(placed.deploymentId),
    )
    expect(Object.keys(await shas(again.deploymentId))).toHaveLength(5)
  })

  it('F35-AC27: Given a zip is taken, When it answers, Then it is not cached, is saved as a file named by the slide and the version, and is not shown by a browser', async () => {
    const placed = await placeFiles(env, alice, files)
    await publish(database, placed.slug, placed.deploymentId)

    const response = await get(`/slides/${placed.slug}/export/published.zip`)
    await response.arrayBuffer()

    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(response.headers.get('Content-Disposition')).toMatch(
      new RegExp(
        `^attachment; filename="${placed.slug}-\\d{8}-${placed.deploymentId.slice(0, 8)}\\.zip"$`,
      ),
    )
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox')
  })

  it('Given a zip, When its length header is read, Then it is the length of the bytes sent', async () => {
    const placed = await placeFiles(env, alice, files)
    await publish(database, placed.slug, placed.deploymentId)

    const response = await get(`/slides/${placed.slug}/export/published.zip`)
    const length = Number(response.headers.get('Content-Length'))
    const zip = await bodyBytes(response)

    expect(length).toBe(zip.length)
  })
})

describe('which versions are offered', () => {
  it('F35-AC4: Given a version newer than the published one, When the owner takes the prepared zip, Then it holds that version and the published zip still holds the old one', async () => {
    const first = await placeFiles(env, alice, files)
    await publish(database, first.slug, first.deploymentId)
    const newer = await placeFiles(
      env,
      alice,
      { ...files, 'index.html': '<!doctype html><title>New</title>' },
      first.slug,
    )

    const prepared = await contents(
      await get(`/slides/${first.slug}/export/prepared.zip`),
    )
    const published = await contents(
      await get(`/slides/${first.slug}/export/published.zip`),
    )

    expect(new TextDecoder().decode(prepared.get('index.html')!)).toContain(
      'New',
    )
    expect(new TextDecoder().decode(published.get('index.html')!)).toContain(
      'Talk',
    )
    expect(newer.deploymentId).not.toBe(first.deploymentId)
  })

  it('F35-AC4: Given nothing newer than the published version, When the owner asks for the prepared zip, Then it answers as a slide that is not there', async () => {
    const placed = await placeFiles(env, alice, files)
    await publish(database, placed.slug, placed.deploymentId)

    const response = await get(`/slides/${placed.slug}/export/prepared.zip`)

    expect(response.status).toBe(404)
  })

  it('F35-AC5: Given past versions the service keeps, When their ids are tried as files, Then none is offered', async () => {
    const first = await placeFiles(env, alice, files)
    const second = await placeFiles(env, alice, files, first.slug)
    await publish(database, first.slug, second.deploymentId)
    const third = await placeFiles(env, alice, files, first.slug)

    for (const id of [
      first.deploymentId,
      second.deploymentId,
      third.deploymentId,
    ])
      expect((await get(`/slides/${first.slug}/export/${id}.zip`)).status).toBe(
        404,
      )
  })

  it('F35-AC6: Given a slide never published, When the owner takes its prepared zip, Then they get its files', async () => {
    const placed = await placeFiles(env, alice, files)

    const response = await get(`/slides/${placed.slug}/export/prepared.zip`)

    expect(response.status).toBe(200)
    expect((await contents(response)).size).toBe(5)
  })

  it('F35-AC6: Given a slide the operator hid, When the owner takes its zip, Then they still get it', async () => {
    const placed = await placeFiles(env, alice, files)
    await publish(database, placed.slug, placed.deploymentId)
    await orm
      .update(decks)
      .set({ hidden_at: 5, hidden_reason: 'test', hidden_by: 'operator' })
      .where(eq(decks.slug, placed.slug))

    const response = await get(`/slides/${placed.slug}/export/published.zip`)

    expect(response.status).toBe(200)
    await response.arrayBuffer()
  })

  it('F35-AC6: Given a slide whose publishing was stopped, When the owner takes its published zip, Then they get the version publishing again would bring back', async () => {
    const placed = await placeFiles(env, alice, files)
    await orm
      .update(decks)
      .set({ paused_at: 9, resume_deployment_id: placed.deploymentId })
      .where(eq(decks.slug, placed.slug))

    expect(
      (await get(`/slides/${placed.slug}/export/published.zip`)).status,
    ).toBe(200)
  })
})

describe('who may take a zip', () => {
  it("F35-AC24: Given another person's slide, When someone else asks for its zip, Then the answer is the one for a slide that is not there", async () => {
    const placed = await placeFiles(env, alice, files)
    await publish(database, placed.slug, placed.deploymentId)

    const foreign = await get(
      `/slides/${placed.slug}/export/published.zip`,
      bob,
    )
    const missing = await get(`/slides/no-such-slide/export/published.zip`, bob)

    expect(foreign.status).toBe(404)
    expect(missing.status).toBe(404)
    // The page is the same but for the address it repeats in its language links.
    const same = (text: string) =>
      text.replaceAll(/\/slides\/[a-z-]+\//g, '/slides/X/')
    expect(same(await foreign.text())).toBe(same(await missing.text()))
  })

  it.each([
    ['published.zip'],
    ['prepared.zip'],
    ['article.md'],
    ['slide.json'],
  ])(
    "F35-AC24: Given another person's slide with an article, When someone else asks for %s, Then nothing of it comes out",
    async (file) => {
      const placed = await placeFiles(env, alice, files)
      await publish(database, placed.slug, placed.deploymentId)

      const response = await get(`/slides/${placed.slug}/export/${file}`, bob)

      expect(response.status).toBe(404)
      expect(await response.text()).not.toContain(placed.deploymentId)
    },
  )

  it('F35-AC24: Given two people with a slide of the same URL name, When one takes their zip, Then it holds their own files', async () => {
    const mine = await placeFiles(
      env,
      alice,
      { 'index.html': 'alice' },
      undefined,
    )
    const theirs = await placeFiles(env, bob, { 'index.html': 'bob' })
    await publish(database, mine.slug, mine.deploymentId)
    await orm
      .update(decks)
      .set({ public_deployment_id: theirs.deploymentId })
      .where(eq(decks.owner_user_id, INVITED_ID))
    expect(theirs.slug).toBe(mine.slug)

    const files = await contents(
      await get(`/slides/${mine.slug}/export/published.zip`, alice),
    )

    expect(new TextDecoder().decode(files.get('index.html')!)).toBe('alice')
  })

  it.each([['published.zip'], ['article.md'], ['slide.json']])(
    'F35-AC25: Given nobody is signed in, When %s is opened, Then they are sent to sign in and nothing is read',
    async (file) => {
      const placed = await placeFiles(env, alice, files)

      const response = await get(`/slides/${placed.slug}/export/${file}`, '')

      expect(response.status).toBe(303)
      expect(response.headers.get('Location')).toBe('/login')
    },
  )

  it('F35-AC26: Given a suspended person, When they ask for their zip, Then they get nothing', async () => {
    const placed = await placeFiles(env, alice, files)
    await publish(database, placed.slug, placed.deploymentId)
    await orm.insert(suspensions).values({
      user_id: OWNER_ID,
      reason: 'test',
      suspended_at: 1,
      suspended_by: 'operator',
    })

    for (const file of ['published.zip', 'slide.json'])
      expect((await get(`/slides/${placed.slug}/export/${file}`)).status).toBe(
        403,
      )
  })

  it('Given a request another site caused, When it asks for a zip, Then it is refused before anything is read', async () => {
    const placed = await placeFiles(env, alice, files)
    await publish(database, placed.slug, placed.deploymentId)

    const response = await get(
      `/slides/${placed.slug}/export/published.zip`,
      alice,
      { 'Sec-Fetch-Site': 'cross-site' },
    )

    expect(response.status).toBe(403)
    // And no lease was taken: the person can still take it themselves.
    expect(
      (await get(`/slides/${placed.slug}/export/published.zip`)).status,
    ).toBe(200)
  })

  it('Given a HEAD request, When it asks for a zip, Then it gets the headers and takes no lease', async () => {
    const placed = await placeFiles(env, alice, files)
    await publish(database, placed.slug, placed.deploymentId)

    const head = await server.fetch(
      new Request(`${TEST_ORIGIN}/slides/${placed.slug}/export/published.zip`, {
        method: 'HEAD',
        headers: { Cookie: alice },
      }),
      env,
    )

    expect(head.status).toBe(200)
    expect(head.headers.get('Content-Type')).toBe('application/zip')
    expect(
      (await platform.env.UPLOADS.list({ prefix: 'exports/' })).objects,
    ).toHaveLength(0)
    expect(
      (await get(`/slides/${placed.slug}/export/published.zip`)).status,
    ).toBe(200)
  })

  it.each(['image', 'iframe', 'script'])(
    'Given a same-origin request a page placed as a %s, When it asks for a zip, Then it is refused and no lease is taken',
    async (dest) => {
      const placed = await placeFiles(env, alice, files)
      await publish(database, placed.slug, placed.deploymentId)

      const response = await get(
        `/slides/${placed.slug}/export/published.zip`,
        alice,
        { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Dest': dest },
      )

      expect(response.status).toBe(403)
      expect(
        (await platform.env.UPLOADS.list({ prefix: 'exports/' })).objects,
      ).toHaveLength(0)
    },
  )

  it.each(['same-origin', 'none'])(
    'Given a browser request marked %s, When it asks for a zip, Then it is answered',
    async (site) => {
      const placed = await placeFiles(env, alice, files)
      await publish(database, placed.slug, placed.deploymentId)

      const response = await get(
        `/slides/${placed.slug}/export/published.zip`,
        alice,
        { 'Sec-Fetch-Site': site },
      )

      expect(response.status).toBe(200)
      await response.arrayBuffer()
    },
  )
})

describe('one zip at a time', () => {
  it('F35-AC29: Given a zip is being made for a person, When they start another, Then they are told to wait; and when the first is done, Then they can', async () => {
    const placed = await placeFiles(env, alice, files)
    await publish(database, placed.slug, placed.deploymentId)
    const first = await get(`/slides/${placed.slug}/export/published.zip`)

    const second = await get(`/slides/${placed.slug}/export/published.zip`)

    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
    expect(Number(second.headers.get('Retry-After'))).toBeGreaterThan(0)
    await first.arrayBuffer()
    // The lease is given back as the stream ends.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const third = await get(`/slides/${placed.slug}/export/published.zip`)
    expect(third.status).toBe(200)
    await third.arrayBuffer()
  })

  it('F35-AC29: Given a download the browser gives up, When it is cancelled, Then the lease is given back', async () => {
    const placed = await placeFiles(env, alice, files)
    await publish(database, placed.slug, placed.deploymentId)
    const first = await get(`/slides/${placed.slug}/export/published.zip`)
    await first.body!.cancel()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const next = await get(`/slides/${placed.slug}/export/published.zip`)

    expect(next.status).toBe(200)
    await next.arrayBuffer()
  })

  it('F35-AC29: Given one person is making a zip, When another person asks for theirs, Then they are not made to wait', async () => {
    const mine = await placeFiles(env, alice, files)
    await publish(database, mine.slug, mine.deploymentId)
    const theirs = await placeFiles(env, bob, files)
    await publish(database, theirs.slug, theirs.deploymentId)
    const first = await get(`/slides/${mine.slug}/export/published.zip`)

    const other = await get(`/slides/${theirs.slug}/export/published.zip`, bob)

    expect(other.status).toBe(200)
    await first.arrayBuffer()
    await other.arrayBuffer()
  })

  it('F35-AC29: Given a lease nobody released, When it has lapsed, Then the person can take a zip again', async () => {
    const placed = await placeFiles(env, alice, files)
    await publish(database, placed.slug, placed.deploymentId)
    await platform.env.UPLOADS.put(`exports/leases/${OWNER_ID}`, 'x', {
      customMetadata: { until: '1' },
    })

    const response = await get(`/slides/${placed.slug}/export/published.zip`)

    expect(response.status).toBe(200)
    await response.arrayBuffer()
  })

  it('F35-AC29: Given a lease is held, When the person asks for the slide information, Then it is not held up', async () => {
    const placed = await placeFiles(env, alice, files)
    await acquireZipLease(
      platform.env.UPLOADS,
      OWNER_ID,
      Math.floor(Date.now() / 1000),
    )

    expect((await get(`/slides/${placed.slug}/export/slide.json`)).status).toBe(
      200,
    )
  })
})

describe('what cannot be written as a faithful zip', () => {
  it('F35-AC8: Given a stored path that climbs out of its folder, When the zip is asked for, Then nothing is sent and no zip names a place outside', async () => {
    const placed = await placeFiles(env, alice, files)
    await publish(database, placed.slug, placed.deploymentId)
    await orm
      .update(uploadFiles)
      .set({ path: '../../outside.html' })
      .where(eq(uploadFiles.path, 'css/site.css'))

    const response = await get(`/slides/${placed.slug}/export/published.zip`)
    const body = await bodyBytes(response)

    expect(response.status).toBe(503)
    expect(response.headers.get('Content-Type')).not.toBe('application/zip')
    expect(new TextDecoder().decode(body)).not.toContain('outside.html')
  })

  it.each(['/etc/passwd', 'a\\b.html', 'C:/x.html', 'a/./b.html'])(
    'F35-AC8: Given the stored path %s, When the zip is asked for, Then it is refused whole',
    async (path) => {
      const placed = await placeFiles(env, alice, files)
      await publish(database, placed.slug, placed.deploymentId)
      await orm
        .update(uploadFiles)
        .set({ path })
        .where(eq(uploadFiles.path, 'css/site.css'))

      const response = await get(`/slides/${placed.slug}/export/published.zip`)
      await response.arrayBuffer()

      expect(response.status).toBe(503)
    },
  )

  it('Given a file whose bytes are gone from storage, When the zip is asked for, Then the download fails instead of finishing a zip that lacks it', async () => {
    const placed = await placeFiles(env, alice, files)
    await publish(database, placed.slug, placed.deploymentId)
    const [row] = await orm
      .select({ key: uploadFiles.object_key })
      .from(uploadFiles)
      .where(eq(uploadFiles.path, 'app.js'))
    await platform.env.UPLOADS.delete(row!.key!)

    const response = await get(`/slides/${placed.slug}/export/published.zip`)

    expect(response.status).toBe(200)
    await expect(response.arrayBuffer()).rejects.toThrow()
    // And the lease was given back.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect((await get(`/slides/${placed.slug}/export/slide.json`)).status).toBe(
      200,
    )
  })

  it("Given a stored file whose row names another version's object, When the zip is asked for, Then that object is not read into the zip", async () => {
    const other = await placeFiles(env, bob, { 'index.html': 'SECRET OF BOB' })
    const [bobFile] = await orm
      .select({ key: uploadFiles.object_key })
      .from(uploadFiles)
      .where(eq(uploadFiles.deployment_id, other.deploymentId))
    const placed = await placeFiles(env, alice, files)
    await publish(database, placed.slug, placed.deploymentId)
    await orm
      .update(uploadFiles)
      .set({ object_key: bobFile!.key })
      .where(eq(uploadFiles.path, 'css/site.css'))

    const response = await get(`/slides/${placed.slug}/export/published.zip`)
    let text = ''
    try {
      text = new TextDecoder().decode(await bodyBytes(response))
    } catch {
      // The stream failed, which is the right outcome.
    }

    expect(text).not.toContain('SECRET OF BOB')
  })

  it('Given more files than a zip may hold, When the zip is asked for, Then it is refused as too large', async () => {
    const placed = await placeFiles(env, alice, files)
    await publish(database, placed.slug, placed.deploymentId)
    const [first] = await orm
      .select()
      .from(uploadFiles)
      .where(eq(uploadFiles.deployment_id, placed.deploymentId))
    for (let start = 0; start < 501; start += 10)
      await orm.insert(uploadFiles).values(
        Array.from({ length: Math.min(10, 501 - start) }, (_, index) => ({
          ...first!,
          id: `x${start + index}`,
          path: `extra/${start + index}.txt`,
        })),
      )

    const response = await get(`/slides/${placed.slug}/export/published.zip`)
    await response.arrayBuffer()

    expect(response.status).toBe(413)
  })

  it("F35-AC9: Given a zip made, When it is read back, Then each entry's size and the picture's digest are the ones the database holds", async () => {
    const placed = await placeFiles(env, alice, files)
    await publish(database, placed.slug, placed.deploymentId)
    const { entries } = await zipOf(
      await get(`/slides/${placed.slug}/export/published.zip`),
    )
    const rows = await orm
      .select({
        path: uploadFiles.path,
        size: uploadFiles.size,
        sha: uploadFiles.sha256,
      })
      .from(uploadFiles)
      .where(eq(uploadFiles.deployment_id, placed.deploymentId))

    for (const row of rows)
      expect(entries.find((entry) => entry.path === row.path)?.size).toBe(
        row.size,
      )
    expect(await sha256Hex(PNG)).toBe(
      rows.find((row) => row.path === 'img/pic.png')?.sha,
    )
  })
})
