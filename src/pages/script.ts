import {
  FRAME_SCRIPT_PATH,
  OFFLINE_MESSAGE,
  STORED_AT_PLACEHOLDER,
} from '../offline/limits'

/** Where a slide loads the script that tells the viewer its page. */
export const PAGE_SCRIPT_PATH = '/_preview/pages.js'

/** The message a slide posts to the viewer when its page changes. */
export const PAGE_MESSAGE = 'slide:page'
/** The viewer's question, for a viewer that started listening late. */
export const PAGE_REQUEST = 'slide:page-request'

/** Marks a document whose page script already runs, so a second one stands down. */
const RUNNING = 'slide.page-script'

/**
 * The script that lets the viewer know which page of a slide is on screen.
 * The service puts it inline in the version's index.html as it serves the
 * file (see inject.ts); `/_preview/pages.js` serves the same text for the
 * slides that load it themselves. Whichever runs first marks the document,
 * and the other does nothing, so a page is never told twice.
 *
 * A page is the number in the fragment, as Marp spells it (`#6`); no
 * fragment is the first page. peitho's viewer keeps it in the query instead
 * (`?slide=6`), and leaves the fragment it was opened with, so the query is
 * read first when it is there. A fragment that is not a page number, such
 * as a heading's or another tool's spelling, tells nothing: guessing the
 * first page would move the reader's address off their page. Tools change
 * the fragment through the History API as well, which fires no event, so
 * those calls are wrapped. Only `viewerOrigin` is told, and only by the
 * slide's own top document. The viewer may start listening after the slide
 * has told its page, so it asks once it does, and the page is told again.
 * The text holds nothing but `viewerOrigin`, which comes from the
 * service's settings, so its hash is the same for every slide.
 *
 * For offline reading (F37) the script does two more things, both only for
 * the viewer. When the viewer asks, it loads the service's own script that
 * keeps the version on the reader's disk. And when the page is a stored copy,
 * which the version's worker says by putting a time in `storedAt` as it
 * serves the copy, it tells the viewer, so the viewer can say so. A page
 * that cannot tell is never served from the disk.
 */
export const pageScript = (viewerOrigin: string) => `(() => {
  const running = Symbol.for(${JSON.stringify(RUNNING)})
  if (window[running]) return
  Object.defineProperty(window, running, { value: true })
  if (parent === window || parent !== top) return
  ${STORED_AT_PLACEHOLDER}
  const numberOf = (text) => {
    const spelled = /^([1-9][0-9]{0,3})$/.exec(text)
    return spelled ? Number(spelled[1]) : null
  }
  const pageOf = () => {
    const query = new URLSearchParams(location.search).get('slide')
    if (query !== null) return numberOf(query)
    if (location.hash === '' || location.hash === '#') return 1
    return numberOf(location.hash.slice(1))
  }
  let told = 0
  const tell = () => {
    const page = pageOf()
    if (page === null || page === told) return
    told = page
    parent.postMessage({ type: ${JSON.stringify(PAGE_MESSAGE)}, page }, ${JSON.stringify(viewerOrigin)})
  }
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name]
    history[name] = function (...args) {
      const result = original.apply(this, args)
      tell()
      return result
    }
  }
  const announce = () => {
    if (storedAt > 0) parent.postMessage({ type: ${JSON.stringify(OFFLINE_MESSAGE.stored)}, at: storedAt }, ${JSON.stringify(viewerOrigin)})
  }
  addEventListener('message', (event) => {
    if (event.source !== parent || event.origin !== ${JSON.stringify(viewerOrigin)}) return
    const type = event.data?.type
    if (type === ${JSON.stringify(PAGE_REQUEST)}) {
      told = 0
      tell()
      announce()
    } else if (type === ${JSON.stringify(OFFLINE_MESSAGE.register)}) {
      import(${JSON.stringify(FRAME_SCRIPT_PATH)})
        .then((frame) => frame.startFrame())
        .then((state) => parent.postMessage({ type: ${JSON.stringify(OFFLINE_MESSAGE.state)}, state }, ${JSON.stringify(viewerOrigin)}))
        .catch(() => {})
    }
  })
  addEventListener('hashchange', tell)
  addEventListener('popstate', tell)
  tell()
  announce()
})()
`

/**
 * The hash of a script's text, spelled as a CSP hash source (`'sha256-…'`).
 * The validator of a served top page names the page script by it.
 */
export async function scriptHashSource(script: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(script),
  )
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`
}
