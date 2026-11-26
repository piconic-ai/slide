import { html, raw } from 'hono/html'
import { OFFLINE_MESSAGE, SHELL_SCRIPT_PATH, VIEWER_ATTRIBUTE } from './limits'

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

/**
 * The page the viewer frames to clear an older version (D-94). The viewer's
 * own policy frames only the version on screen, so it frames this page, which
 * frames the old version's eviction page and passes on its answer. The
 * version's origin is in the fragment, which no server sees. The page is the
 * same for every version and holds nothing.
 */
export const managementEvictPage = (contentBase: string) =>
  html`<!doctype html>
    <html
      ${VIEWER_ATTRIBUTE.evict}
      ${raw(VIEWER_ATTRIBUTE.contentBase)}="${contentBase}"
    >
      <meta charset="utf-8" />
      <meta name="robots" content="noindex" />
      <script type="module" src="${SHELL_SCRIPT_PATH}"></script>
    </html>`

/** The page above may frame the versions' origins and nothing else, and only the viewer may frame it. */
export const managementEvictPolicy = (contentBase: URL) =>
  [
    "default-src 'none'",
    `frame-src ${contentBase.protocol}//*.${contentBase.host}`,
    "script-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join('; ')
