import type { Context, Hono } from 'hono'
import { randomToken } from '../auth/owner-session'
import { evictPage, evictPagePolicy } from './evict-pages'
import {
  CLIENT_ASSET_PATH,
  EVICT_PATH,
  FRAME_SCRIPT_PATH,
  VERSION_WORKER_PATH,
  WORKER_ASSET_PATH,
} from './limits'

type VersionContext = Context<{ Bindings: Env }>

/** A built file of the service, read from the assets by the management origin's address. */
async function builtFile(c: VersionContext, path: string) {
  const asset = await c.env.ASSETS.fetch(
    new Request(new URL(path, c.env.PUBLIC_ORIGIN)),
  ).catch(() => null)
  return asset?.ok ? asset.text() : null
}

/**
 * The service's own files on a version's origin: its worker, the script the
 * worker's frame loads, and the page that clears what the origin kept. All
 * are the same for every reader and every version and hold nothing private.
 * They sit under `_preview/`, which author files never reach.
 */
export function versionOfflineRoutes(app: Hono<{ Bindings: Env }>) {
  app.get(VERSION_WORKER_PATH, async (c) => {
    const source = await builtFile(c, WORKER_ASSET_PATH)
    if (source === null) return c.text('Not found', 404)
    return c.body(source, 200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      // The worker may control the whole origin, not just `_preview/`.
      'Service-Worker-Allowed': '/',
      // A worker is looked for anew at least once a day; it is not kept longer.
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      // The worker asks this origin and nothing else.
      'Content-Security-Policy': "default-src 'none'; connect-src 'self'",
    })
  })
  app.get(FRAME_SCRIPT_PATH, async (c) => {
    const source = await builtFile(c, CLIENT_ASSET_PATH)
    if (source === null) return c.text('Not found', 404)
    return c.body(source, 200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    })
  })
  app.get(EVICT_PATH, (c) => {
    const nonce = randomToken()
    const viewer = new URL(c.env.PUBLIC_ORIGIN).origin
    c.header('Content-Security-Policy', evictPagePolicy(viewer, nonce))
    c.header('Cache-Control', 'no-store')
    return c.html(evictPage(viewer, nonce))
  })
}
