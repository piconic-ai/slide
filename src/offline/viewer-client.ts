// Runs on the management origin: in the viewer (startViewer, which share.js
// calls for each viewer page it shows) and in the shell the viewer's worker
// gives when there is no connection (startShell). It keeps the list of the
// versions opened, counts them and their days, clears the ones that go, and
// shows the band when a stored version is on screen. Nothing here throws: a
// browser that cannot do this leaves the viewer as it is.
import {
  EVICT_PATH,
  MANAGEMENT_EVICT_PATH,
  isVersionOrigin,
  OFFLINE_MESSAGE,
  VIEWER_ATTRIBUTE,
  WORKER_ASSET_PATH,
} from './limits'
import { shellKeeper, type ShellCache } from './viewer-shells'

const EVICT_WAIT_MS = 10_000

/** The browser's cache, by address, as the list of kept decks uses it. */
const shellCache = async (name: string): Promise<ShellCache> => {
  const cache = await caches.open(name)
  return {
    keys: () => cache.keys(),
    match: (key) => cache.match(key),
    put: (key, response) => cache.put(key, response),
    delete: (key) => cache.delete(key),
  }
}

const supported = () => {
  try {
    return 'serviceWorker' in navigator && 'caches' in window
  } catch {
    return false
  }
}

/** The one frame of the slides this page is about, and the origin it was given. */
function slidesFrame() {
  const frame = document.querySelector<HTMLIFrameElement>(
    'iframe#deck[data-share]',
  )
  const src = frame?.getAttribute('src')
  return frame && src
    ? { frame, origin: new URL(src, location.href).origin }
    : null
}

/** Puts the band into its live region, once. */
function showBand() {
  const slot = document.querySelector(`[${VIEWER_ATTRIBUTE.band}]`)
  const template = document.querySelector<HTMLTemplateElement>(
    `template[${VIEWER_ATTRIBUTE.bandTemplate}]`,
  )
  if (slot && template && slot.childElementCount === 0)
    slot.appendChild(template.content.cloneNode(true))
}

let listening = false

/** Listens once for the frame's words and the band's button; the page they are about is found as they come. */
function listen(
  frameOf: () => { frame: HTMLIFrameElement; origin: string } | null,
  onState: (origin: string) => void,
) {
  if (listening) return
  listening = true
  addEventListener('message', (event) => {
    const slides = frameOf()
    if (!slides || event.source !== slides.frame.contentWindow) return
    if (event.origin !== slides.origin) return
    const data = event.data as { type?: unknown; state?: unknown } | null
    if (data?.type === OFFLINE_MESSAGE.stored) showBand()
    else if (data?.type === OFFLINE_MESSAGE.state && data.state === 'stored')
      onState(slides.origin)
  })
  document.addEventListener('click', (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest(`[${VIEWER_ATTRIBUTE.reload}]`)
    )
      location.reload()
  })
}

/** Opens a hidden frame of a version's origin on its eviction page and waits for it to say it has cleared. */
function evictFrame(origin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.hidden = true
    frame.tabIndex = -1
    frame.setAttribute('aria-hidden', 'true')
    const done = (cleared: boolean) => {
      removeEventListener('message', heard)
      clearTimeout(timer)
      frame.remove()
      resolve(cleared)
    }
    const heard = (event: MessageEvent) => {
      if (
        event.source === frame.contentWindow &&
        event.origin === location.origin &&
        (event.data as { type?: unknown } | null)?.type ===
          OFFLINE_MESSAGE.evicted
      )
        done(true)
    }
    const timer = setTimeout(() => done(false), EVICT_WAIT_MS)
    addEventListener('message', heard)
    frame.src = `${MANAGEMENT_EVICT_PATH}#${origin}`
    document.body.appendChild(frame)
  })
}

export function startViewer(root: ParentNode): void {
  try {
    if (!supported()) return
    const slides = root.querySelector<HTMLIFrameElement>(
      'iframe#deck[data-share]',
    )
    const holder = root.querySelector(`[${VIEWER_ATTRIBUTE.shell}]`)
    const shell = holder?.getAttribute(VIEWER_ATTRIBUTE.shell)
    // The content domain the service is set to, which every origin is held to.
    const contentBase = holder?.getAttribute(VIEWER_ATTRIBUTE.contentBase) ?? ''
    const path = slides?.dataset.share
    const src = slides?.getAttribute('src')
    // Only public slides in a frame carry a shell; nothing else is kept.
    if (!slides || !shell || !path || !src) return
    const origin = new URL(src, location.href).origin
    if (!isVersionOrigin(origin, contentBase)) return
    const shells = shellKeeper(
      {
        managementOrigin: location.origin,
        contentBase,
        now: Date.now,
        openCache: shellCache,
        clearVersion: evictFrame,
      },
      origin,
    )
    // Whether the list is at rest: no write or prune is queued or running, and
    // the page's own prune has been asked for. The page says so on its root, so
    // a caller that must act on the list (a test, a later tab) can wait for
    // it, instead of guessing how long the steps take.
    let pending = 0
    let pruneAsked = false
    const report = () => {
      document.documentElement.setAttribute(
        VIEWER_ATTRIBUTE.listIdle,
        String(pending === 0 && pruneAsked),
      )
    }
    const track = (work: Promise<unknown>) => {
      pending++
      report()
      return work
        .catch(() => {})
        .then(() => {
          pending--
          report()
        })
    }
    report()
    // The frame says it is stored each time it is asked, and the viewer asks
    // twice (at once, and when the frame has loaded). The shell is the same,
    // so it is written once: a second write, late, would bring back a deck
    // the service withdrew in the meantime (F37-AC7 to AC9).
    let written = false
    listen(slidesFrame, (from) => {
      if (from !== origin || written) return
      written = true
      void track(shells.keep(shell, path, origin))
    })
    navigator.serviceWorker
      .register(
        `${WORKER_ASSET_PATH}?base=${encodeURIComponent(contentBase)}`,
        { scope: '/@' },
      )
      .catch(() => {})
    const ask = () =>
      slides.contentWindow?.postMessage(
        { type: OFFLINE_MESSAGE.register },
        origin,
      )
    slides.addEventListener('load', ask)
    ask()
    // What the service stopped showing is cleared once the page has loaded,
    // and the page's load waits for the slides' frame, so it never competes
    // with the first paint. A deck whose version could not be stored never
    // keeps a shell, and would otherwise leave its origin on the list
    // (F37-AC22). This module is loaded late, so the load may have passed.
    const clear = () => {
      pruneAsked = true
      void track(shells.prune())
    }
    if (document.readyState === 'complete') clear()
    else addEventListener('load', clear, { once: true })
  } catch {}
}

export function startShell(): void {
  try {
    const frame = document.querySelector<HTMLIFrameElement>(
      'iframe[data-offline-frame]',
    )
    const origin = frame?.dataset.origin ?? ''
    const contentBase = document.documentElement.dataset.contentBase ?? ''
    if (!frame || !isVersionOrigin(origin, contentBase)) return
    listen(
      () => ({ frame, origin }),
      () => {},
    )
    // The page asked for, which the slides open on as a fragment reads it.
    const page = /^\/@[^/]+\/[^/]+\/([1-9][0-9]{0,3})$/.exec(
      location.pathname,
    )?.[1]
    frame.src = `${origin}/${page ? `#${page}` : ''}`
  } catch {}
}

/**
 * Runs in the management origin's eviction page, a frame of the viewer: opens
 * the old version's eviction page under itself and passes its answer on. The
 * viewer's policy does not name old versions, so it cannot frame them.
 */
export function startEvict(): void {
  try {
    const origin = decodeURIComponent(location.hash.slice(1))
    const contentBase = document.documentElement.dataset.contentBase ?? ''
    if (!isVersionOrigin(origin, contentBase)) return
    const frame = document.createElement('iframe')
    frame.hidden = true
    addEventListener('message', (event) => {
      if (
        event.source !== frame.contentWindow ||
        event.origin !== origin ||
        (event.data as { type?: unknown } | null)?.type !==
          OFFLINE_MESSAGE.evicted
      )
        return
      parent.postMessage({ type: OFFLINE_MESSAGE.evicted }, location.origin)
    })
    frame.src = `${origin}${EVICT_PATH}`
    document.body.appendChild(frame)
  } catch {}
}

// The shell and the eviction page run themselves: they have no script of
// their own to call this from.
if (
  typeof document !== 'undefined' &&
  document.documentElement.hasAttribute(VIEWER_ATTRIBUTE.evict)
)
  startEvict()
if (
  typeof document !== 'undefined' &&
  document.documentElement.hasAttribute(VIEWER_ATTRIBUTE.shell)
)
  startShell()
