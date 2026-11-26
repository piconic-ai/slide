import { html } from 'hono/html'
import { OFFLINE_MESSAGE } from './limits'

/**
 * What the viewer opens in a hidden frame of a version's origin to clear what
 * that origin kept: the page unregisters the origin's workers, empties its
 * cache, and tells the viewer, which then drops the frame. A version's
 * storage cannot be reached from another origin, so this is the only way
 * the viewer can ask for it (D-94). It holds nothing of the author's and
 * touches nothing but what the frame's own page may.
 */
export const evictPage = (viewerOrigin: string, nonce: string) =>
  html`<!doctype html>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex" />
    <script nonce="${nonce}">
      ;(async () => {
        try {
          for (const registration of await navigator.serviceWorker.getRegistrations())
            await registration.unregister()
        } catch {}
        try {
          for (const name of await caches.keys()) await caches.delete(name)
        } catch {}
        if (parent !== window)
          parent.postMessage(
            { type: '${OFFLINE_MESSAGE.evicted}' },
            '${viewerOrigin}',
          )
      })()
    </script>`

/** The policy of that page; only the viewer may frame it. */
export const evictPagePolicy = (viewerOrigin: string, nonce: string) =>
  `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors ${viewerOrigin}`
