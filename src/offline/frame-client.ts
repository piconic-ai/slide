// Runs in a version's frame, when the viewer asks it to keep the version
// (OFFLINE_MESSAGE.register). It registers the version's worker and makes
// sure the page on screen is on the disk. It never throws: a browser that
// cannot do this leaves the slides as they are.
import {
  KEEP_MESSAGE,
  STORED_AT_HEADER,
  VERSION_CACHE,
  VERSION_WORKER_PATH,
  type OfflineState,
} from './limits'

const WAIT_MS = 15_000

/** Gives up on a promise that never settles; a worker that cannot start leaves the frame waiting. */
const within = <T>(work: Promise<T>) =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), WAIT_MS),
    ),
  ])

/** The page's own address and the files it has loaded from this origin. */
const loadedAddresses = () => [
  location.href,
  ...performance
    .getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(`${location.origin}/`)),
]

/** Asks the worker to keep these files, and waits until it has tried; whether all could be kept. */
function keep(worker: ServiceWorker, urls: readonly string[]) {
  return within(
    new Promise<boolean>((resolve) => {
      const channel = new MessageChannel()
      channel.port1.onmessage = (event: MessageEvent) =>
        resolve((event.data as { failed?: unknown } | null)?.failed === 0)
      worker.postMessage({ type: KEEP_MESSAGE, urls }, [channel.port2])
    }),
  )
}

/** Whether the page on screen is kept, with the time it was fetched at. */
async function pageIsKept() {
  const here = new URL(location.href)
  here.hash = ''
  const cache = await caches.open(VERSION_CACHE)
  const kept = await cache.match(here.href, { ignoreVary: true })
  return Number.isFinite(Number(kept?.headers.get(STORED_AT_HEADER)))
}

export async function startFrame(): Promise<OfflineState> {
  try {
    if (!('serviceWorker' in navigator) || !('caches' in window))
      return 'unsupported'
    await navigator.serviceWorker.register(VERSION_WORKER_PATH, { scope: '/' })
    const ready = await within(navigator.serviceWorker.ready)
    // What loaded before the worker was in charge was not seen by it, and
    // the worker takes charge of a loaded frame as it starts, so being
    // controlled says nothing: only the page being on the disk does.
    // A file that could not be kept leaves the version not whole on the
    // disk: no shell is written for it.
    if (!(await pageIsKept()) && ready.active)
      if (!(await keep(ready.active, loadedAddresses()))) return 'unsupported'
    return (await pageIsKept()) ? 'stored' : 'unsupported'
  } catch {
    return 'unsupported'
  }
}
