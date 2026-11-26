import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import server from '../app/routes'
import { decks } from '../db/schema'
import { TEST_ORIGIN } from '../publication/test-support'

export type TestFiles = Readonly<Record<string, string | Uint8Array>>

const bytesOf = (value: string | Uint8Array) =>
  typeof value === 'string' ? new TextEncoder().encode(value) : value

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new Uint8Array(bytes).buffer,
  )
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

let attempts = 0
const nextAttempt = () =>
  `export-test-attempt-${String(++attempts).padStart(6, '0')}`

export type Placed = Readonly<{ deploymentId: string; slug: string }>

/**
 * Puts the files up as the signed-in author's browser would, over HTTP:
 * start, send each file, finalize. A new slide when `slug` is not given,
 * else a new version of that slide. The environment must allow enough
 * files, bytes and starts for the files.
 */
export async function placeFiles(
  env: Env,
  cookie: string,
  files: TestFiles,
  slug?: string,
): Promise<Placed> {
  const entries = await Promise.all(
    Object.entries(files).map(async ([path, value]) => {
      const bytes = bytesOf(value)
      return { path, bytes, size: bytes.length, sha256: await sha256Hex(bytes) }
    }),
  )
  const url = slug
    ? `${TEST_ORIGIN}/api/slides/${slug}/uploads`
    : `${TEST_ORIGIN}/api/slides`
  const started = await server.fetch(
    new Request(url, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        attempt: nextAttempt(),
        entry: 'index.html',
        files: entries.map(({ path, size, sha256 }) => ({
          path,
          size,
          sha256,
        })),
      }),
    }),
    env,
  )
  if (started.status !== 201)
    throw new Error(`start failed: ${started.status} ${await started.text()}`)
  const body = (await started.json()) as {
    deploymentId: string
    credential: string
    slug: string
    files: { id: string; path: string }[]
  }
  const auth = { Authorization: `Bearer ${body.credential}` }
  for (const file of body.files) {
    const entry = entries.find((candidate) => candidate.path === file.path)!
    const put = await server.fetch(
      new Request(
        `${TEST_ORIGIN}/api/uploads/${body.deploymentId}/files/${file.id}`,
        { method: 'PUT', headers: auth, body: new Uint8Array(entry.bytes) },
      ),
      env,
    )
    if (put.status !== 200)
      throw new Error(`put failed: ${put.status} ${await put.text()}`)
  }
  const done = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/uploads/${body.deploymentId}/finalize`, {
      method: 'POST',
      headers: auth,
    }),
    env,
  )
  if (done.status !== 200)
    throw new Error(`finalize failed: ${done.status} ${await done.text()}`)
  return { deploymentId: body.deploymentId, slug: body.slug }
}

/** Makes the version the one readers see, as publishing does. */
export async function publish(
  db: D1Database,
  slug: string,
  deploymentId: string,
) {
  await drizzle(db)
    .update(decks)
    .set({ public_deployment_id: deploymentId, first_published_at: 100 })
    .where(eq(decks.slug, slug))
}

/** Reads a whole response body, as a browser saving a download would. */
export async function bodyBytes(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer())
}
