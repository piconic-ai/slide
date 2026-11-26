// The entry of the offline worker, built into public/offline-sw.js. The
// same file is a version's worker (served from the version's origin at
// VERSION_WORKER_PATH) and, from the management origin, the viewer's. The
// decisions are in version-worker.ts; this only wires them to the browser.
import {
  isHandledRequest,
  KEEP_MESSAGE,
  VERSION_CACHE,
  VERSION_WORKER_PATH,
  WORKER_ASSET_PATH,
} from './limits'
import { keepFiles, respond, type VersionWorkerDeps } from './version-worker'
import {
  installScript,
  isShellScript,
  isViewerNavigation,
  respondScript,
  respondViewer,
  type ViewerWorkerDeps,
} from './viewer-worker'

type Extendable = Event & { waitUntil(work: Promise<unknown>): void }
type FetchEvent = Extendable & {
  request: Request
  preloadResponse: Promise<Response | undefined>
  respondWith(answer: Promise<Response>): void
}
type MessageEvent = Extendable & {
  data: unknown
  ports: readonly MessagePort[]
}
type Scope = {
  location: Location
  caches: CacheStorage
  clients: { claim(): Promise<void> }
  skipWaiting(): Promise<void>
  fetch(request: Request): Promise<Response>
  addEventListener(type: string, listener: (event: never) => void): void
}
const scope = self as unknown as Scope

/** What a version's worker needs, for one event. */
const versionDeps = (event: Extendable): VersionWorkerDeps => ({
  origin: scope.location.origin,
  now: () => Date.now(),
  ask: (request) => scope.fetch(request),
  openCache: () => scope.caches.open(VERSION_CACHE),
  deleteCache: async () => void (await scope.caches.delete(VERSION_CACHE)),
  waitUntil: (work) => event.waitUntil(work),
})

const URL_LIMIT = 2000

/** The addresses of a keep message, or none when it is not one. */
function urlsOf(data: unknown): string[] {
  if (typeof data !== 'object' || data === null) return []
  const message = data as { type?: unknown; urls?: unknown }
  if (message.type !== KEEP_MESSAGE || !Array.isArray(message.urls)) return []
  return message.urls
    .filter((url): url is string => typeof url === 'string')
    .slice(0, URL_LIMIT)
}

function startVersionWorker() {
  scope.addEventListener('install', (event: Extendable) =>
    event.waitUntil(scope.skipWaiting()),
  )
  scope.addEventListener('activate', (event: Extendable) =>
    event.waitUntil(
      (async () => {
        await scope.clients.claim()
        // Navigation preload is left off: with it on, Firefox fails a
        // navigation outright when the connection is reset, before the
        // worker can answer from the disk (docs/dev/f37-offline-reading.md).
      })(),
    ),
  )
  scope.addEventListener('fetch', (event: FetchEvent) => {
    if (!isHandledRequest(event.request, scope.location.origin)) return
    event.respondWith(
      respond(versionDeps(event), event.request, event.preloadResponse),
    )
  })
  scope.addEventListener('message', (event: MessageEvent) => {
    const urls = urlsOf(event.data)
    const port = event.ports[0]
    if (urls.length === 0 || !port) return
    event.waitUntil(
      keepFiles(versionDeps(event), urls)
        .catch(() => 0)
        .then((kept) => port.postMessage({ kept })),
    )
  })
}

/** What the viewer's worker needs, for one event. */
const viewerDeps = (event: Extendable): ViewerWorkerDeps => ({
  origin: scope.location.origin,
  now: () => Date.now(),
  ask: (request) => scope.fetch(request),
  openCache: (name) => scope.caches.open(name),
  waitUntil: (work) => event.waitUntil(work),
})

function startViewerWorker() {
  scope.addEventListener('install', (event: Extendable) =>
    // The shell's script is kept first: a worker without it would show a
    // shell that cannot run.
    event.waitUntil(
      installScript(viewerDeps(event)).then(() => scope.skipWaiting()),
    ),
  )
  scope.addEventListener('activate', (event: Extendable) =>
    event.waitUntil(scope.clients.claim()),
  )
  scope.addEventListener('fetch', (event: FetchEvent) => {
    const origin = scope.location.origin
    if (isViewerNavigation(event.request, origin))
      event.respondWith(respondViewer(viewerDeps(event), event.request))
    else if (isShellScript(event.request, origin))
      event.respondWith(respondScript(viewerDeps(event), event.request))
  })
}

if (scope.location.pathname === VERSION_WORKER_PATH) startVersionWorker()
else if (scope.location.pathname === WORKER_ASSET_PATH) startViewerWorker()
