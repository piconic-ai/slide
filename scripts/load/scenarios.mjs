// What one simulated reader or author does, step by step, through the client.
// A reader behaves as a browser does: the viewer page, the session, the files
// the viewer page names, then the slide's own page in its frame and the files
// that page names, a few at a time as a browser opens its connections.
import { createHash } from 'node:crypto'
import { firstFrame, subresources } from './html-resources.mjs'

/** How many requests a browser keeps open to one host. */
const PARALLEL = 6

/**
 * Runs `work` over the items, at most `width` at once.
 *
 * @template T
 * @param {T[]} items
 * @param {number} width
 * @param {(item: T) => Promise<unknown>} work
 */
export async function inBatches(items, width, work) {
  for (let at = 0; at < items.length; at += width)
    await Promise.all(items.slice(at, at + width).map(work))
}

/**
 * One reader opening one slide: `slidePath` is the share URL's path, such as
 * `/@alice/talk`. Requests are named by what they are for.
 *
 * @param {{ client: ReturnType<typeof import('./client.mjs').makeClient>, base: string, slidePath: string }} options
 */
export async function openSlide({ client, base, slidePath }) {
  const page = await client.request(
    'viewer-page',
    new URL(slidePath, base).href,
  )
  if (page.status !== 200) return
  const html = page.text()
  const frame = firstFrame(html, page.url)
  await Promise.all([
    client.request('session', new URL('/api/session', base).href),
    inBatches(subresources(html, page.url), PARALLEL, (address) =>
      client.request('viewer-asset', address),
    ),
    frame ? openFrame(client, frame) : Promise.resolve(),
  ])
}

/** The slide's own page, and the files it names. */
async function openFrame(client, frame) {
  const document = await client.request('slide-page', frame)
  if (document.status !== 200) return
  await inBatches(subresources(document.text(), frame), PARALLEL, (address) =>
    client.request('slide-file', address),
  )
}

/**
 * The files of a slide to put up: an entry page and `count - 1` small
 * scripts, different for each upload so no two versions are the same.
 *
 * @param {{ count: number, bytes: number, seed: string }} options
 * @returns {{ path: string, bytes: Uint8Array }[]}
 */
export function slideFiles({ count, bytes, seed }) {
  const encoder = new TextEncoder()
  const body = (index) =>
    encoder.encode(`// ${seed} ${index}\n`.padEnd(Math.max(bytes, 16), '.'))
  const scripts = Array.from(
    { length: Math.max(0, count - 1) },
    (_, index) => ({
      path: `assets/part-${index}.js`,
      bytes: body(index),
    }),
  )
  const entry = `<!doctype html><title>Load ${seed}</title>${scripts
    .map((file) => `<script src="${file.path}"></script>`)
    .join('')}`
  return [{ path: 'index.html', bytes: encoder.encode(entry) }, ...scripts]
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/**
 * One author putting up a new slide: start, each file, finalize, as the
 * browser does. `cookie` is the author's session cookie.
 *
 * @param {{
 *   client: ReturnType<typeof import('./client.mjs').makeClient>,
 *   base: string,
 *   cookie: string,
 *   attempt: string,
 *   files: { path: string, bytes: Uint8Array }[],
 * }} options
 * @returns {Promise<'ready' | 'refused' | 'failed'>}
 */
export async function putSlideUp({ client, base, cookie, attempt, files }) {
  const sameOrigin = { Cookie: cookie, Origin: new URL(base).origin }
  const started = await client.request(
    'upload-start',
    new URL('/api/slides', base).href,
    {
      method: 'POST',
      headers: { ...sameOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attempt,
        entry: 'index.html',
        files: files.map((file) => ({
          path: file.path,
          size: file.bytes.length,
          sha256: sha256(file.bytes),
        })),
      }),
    },
  )
  if (started.status === 429 || started.status === 409) return 'refused'
  if (started.status !== 201) return 'failed'
  const grant = JSON.parse(started.text())
  const authorization = { Authorization: `Bearer ${grant.credential}` }
  const byPath = new Map(files.map((file) => [file.path, file.bytes]))
  // The service takes one file at a time for a version (a lease), as the
  // browser sends them.
  await inBatches(grant.files, 1, (file) =>
    client.request(
      'upload-file',
      new URL(`/api/uploads/${grant.deploymentId}/files/${file.id}`, base).href,
      { method: 'PUT', headers: authorization, body: byPath.get(file.path) },
    ),
  )
  const done = await client.request(
    'upload-finalize',
    new URL(`/api/uploads/${grant.deploymentId}/finalize`, base).href,
    { method: 'POST', headers: authorization },
  )
  return done.status === 200 ? 'ready' : 'failed'
}
