import { createServer, type Server } from 'node:http'
import { drizzle } from 'drizzle-orm/d1'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { seedPublic, signIn, testEnv } from '../publication/test-support'

/**
 * The real Worker behind a real HTTP server, for browser tests of offline
 * reading: a Service Worker's own requests do not go through Playwright's
 * routes, so the browser has to talk to a server. The management origin is
 * `localhost` and each version has its own `d-<id>.localhost`.
 */
export type Down = 'up' | 'down' | number

export type World = Awaited<ReturnType<typeof createWorld>>

/** An index page of a deck whose first heading is `heading`. */
export const indexOf = (heading: string) =>
  `<!doctype html><html><head><title>${heading}</title></head><body><h1 id="title">${heading}</h1><img src="img/dot.svg" id="dot"></body></html>`

export const FILES = (heading: string): Record<string, [string, string]> => ({
  'index.html': ['text/html; charset=utf-8', indexOf(heading)],
  'img/dot.svg': [
    'image/svg+xml',
    '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>',
  ],
  // A file an author may name the way the service names its worker.
  '_preview/sw.js': ['text/javascript', 'throw new Error("author file")'],
  'sw.js': ['text/javascript', 'self.addEventListener("fetch", () => {})'],
})

export async function createWorld() {
  const platform = await getPlatformProxy<Env>({ persist: false })
  const db = platform.env.DB
  const orm = drizzle(db)
  /** How each origin answers: a version's by its deployment id, the management origin's by `management`. */
  const states = new Map<string, Down>()
  let port = 0
  let env = platform.env as Env
  const http: Server = createServer(async (request, response) => {
    const host = request.headers.host ?? ''
    const id = /^d-([^.]+)\./.exec(host)?.[1] ?? 'management'
    const state = states.get(id) ?? 'up'
    if (state === 'down') return void request.socket.destroy()
    if (typeof state === 'number') {
      response.writeHead(state, {
        'Content-Type': 'text/plain',
        ...(state === 503
          ? {
              'Retry-After': '300',
              'X-Slide-Intended': 'maintenance',
              'X-Slide-Maintenance': 'on',
            }
          : {}),
      })
      return void response.end(`status ${state}`)
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const headers = new Headers()
    for (const [name, value] of Object.entries(request.headers))
      if (value !== undefined) headers.set(name, String(value))
    const answer = await server.fetch(
      new Request(`http://${host}${request.url}`, {
        method: request.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
        redirect: 'manual',
      }),
      env,
    )
    response.writeHead(answer.status, Object.fromEntries(answer.headers))
    response.end(Buffer.from(await answer.arrayBuffer()))
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const address = http.address()
  port = typeof address === 'object' && address ? address.port : 0
  env = {
    ...testEnv(platform.env),
    PUBLIC_ORIGIN: `http://localhost:${port}`,
    CONTENT_ORIGIN: `http://localhost:${port}`,
  } as unknown as Env
  await applyMigrations(db)
  // Makes the author, whose handle the share URLs name.
  await signIn(env)

  async function putFiles(id: string, files: Record<string, [string, string]>) {
    for (const [at, [path, [type, body]]] of Object.entries(files).entries()) {
      const key = `${id}/${at}/lease`
      await platform.env.UPLOADS.put(key, body)
      const digest = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)),
      ).toString('hex')
      await orm.insert(uploadFiles).values({
        deployment_id: id,
        id: String(at),
        path,
        size: body.length,
        sha256: digest,
        media_type: type,
        object_key: key,
      })
    }
  }

  /** A public deck, `owner/<slug>`, whose heading is `heading`. */
  async function publish(slug: string, heading: string, readyAt = 1) {
    const id = await seedPublic(db, slug, readyAt, heading)
    await putFiles(id, FILES(heading))
    return id
  }

  return {
    db,
    orm,
    env: () => env,
    states,
    port,
    putFiles,
    publish,
    viewer: (slug: string, query = '') =>
      `http://localhost:${port}/@owner/${slug}${query}`,
    origin: (id: string) => `http://d-${id}.localhost:${port}`,
    async close() {
      http.close()
      await platform.dispose()
    },
  }
}
