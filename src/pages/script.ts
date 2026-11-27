import {
  FRAME_SCRIPT_PATH,
  OFFLINE_MESSAGE,
  STORED_AT_PLACEHOLDER,
} from '../offline/limits'
import { READING_SOURCE } from './reading'

/** Where a slide loads the script that tells the viewer its page. */
export const PAGE_SCRIPT_PATH = '/_preview/pages.js'

/** The message a slide posts to the viewer when its page changes. */
export const PAGE_MESSAGE = 'slide:page'
/** The viewer's request that the slides move to a page, with its `page`. */
export const OPEN_MESSAGE = 'slide:open'
/** The slides' answer to OPEN_MESSAGE: they took the request, with its `id`. */
export const OPENED_MESSAGE = 'slide:opened'
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
  // Only slides the viewer shows directly tell their page. A capture of the
  // page image (the slides are the top document) and an embed on another site
  // (their parent is not the top) are opened at a page too, so the tool's own
  // reading below still runs; they tell nobody.
  const viewed = parent !== window && parent === top
  ${STORED_AT_PLACEHOLDER}
  ${READING_SOURCE}
  // What a slide tool shows, once the script has recognised the tool by its
  // own API (see the readers below). Until then, and for slides of no known
  // tool, the page is what the address says.
  let tool = null
  const pageOf = () => tool ? tool.pageOf() : pageIn(location.search, location.hash)
  // The page the reader was sent to, as the address said when this ran.
  const requested = requestedIn(location.hash)
  // Once a tool is recognised: the page the reader was sent to is opened,
  // and the viewer is told the page.
  const startTool = () => {
    if (requested !== null) tool.open(requested)
    tell()
  }
  // The hash this script set itself, which is not a request.
  let ours = null
  let told = 0
  const tell = () => {
    const page = pageOf()
    if (!viewed || page === null || page === told) return
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
    if (!viewed) return
    if (storedAt > 0) parent.postMessage({ type: ${JSON.stringify(OFFLINE_MESSAGE.stored)}, at: storedAt }, ${JSON.stringify(viewerOrigin)})
  }
  addEventListener('message', (event) => {
    if (!viewed || event.source !== parent || event.origin !== ${JSON.stringify(viewerOrigin)}) return
    const type = event.data?.type
    if (type === ${JSON.stringify(PAGE_REQUEST)}) {
      told = 0
      tell()
      announce()
    } else if (type === ${JSON.stringify(OPEN_MESSAGE)}) {
      // The article's image of a page (F03-AC193). A tool is told in its own
      // way; for slides of no known tool the page goes where it is read from.
      const asked = numberOf(String(event.data.page))
      if (asked === null) return
      parent.postMessage({ type: ${JSON.stringify(OPENED_MESSAGE)}, page: asked, id: event.data.id }, ${JSON.stringify(viewerOrigin)})
      // For slides of no known tool the address is where the page is read
      // from, as it was before the service knew any tool: the version's top
      // with the page as the fragment, which drops what a tool such as
      // peitho keeps in the query.
      if (tool) tool.open(asked)
      else location.replace(location.origin + '/#' + asked)
    } else if (type === ${JSON.stringify(OFFLINE_MESSAGE.register)}) {
      import(${JSON.stringify(FRAME_SCRIPT_PATH)})
        .then((frame) => frame.startFrame())
        .then((state) => parent.postMessage({ type: ${JSON.stringify(OFFLINE_MESSAGE.state)}, state }, ${JSON.stringify(viewerOrigin)}))
        .catch(() => {})
    }
  })
  // reveal.js. Its API is global when the page loads it with a script tag,
  // and it tells the page of its own events (they bubble to the document):
  // 'ready' once it has laid the slides out, 'slidechanged' when a slide
  // shows. It reads the address once, on start, as a number from 0 (#3 is
  // the fourth slide), so the page asked for is opened when it is ready.
  const revealOf = () => {
    const deck = window.Reveal
    const known = deck && typeof deck.isReady === 'function' && typeof deck.getIndices === 'function' && typeof deck.slide === 'function'
    return known && deck.isReady() && document.querySelector('.reveal .slides') ? deck : null
  }
  // How many slides each column holds: a column that is a stack holds the
  // slides inside it, any other holds itself.
  const columnsOf = () => Array.from(document.querySelectorAll('.reveal .slides > section'), (column) => Math.max(1, column.querySelectorAll(':scope > section').length))
  const startReveal = () => {
    const deck = tool ? null : revealOf()
    if (!deck) return
    tool = {
      pageOf: () => {
        const at = deck.getIndices()
        return pageOfSlide(columnsOf(), at.h, at.v)
      },
      open: (page) => {
        const slide = slideOfPage(columnsOf(), page)
        if (!slide) return
        // Without the slides' move from one to another, which would show, and
        // at the first step of the slide: going back to a slide, reveal.js
        // shows all its fragments unless told which one.
        const slides = document.querySelector('.reveal .slides')
        slides.classList.add('no-transition')
        deck.slide(slide.h, slide.v, -1)
        void slides.offsetWidth
        slides.classList.remove('no-transition')
      },
    }
    startTool()
  }
  document.addEventListener('ready', startReveal)
  document.addEventListener('slidechanged', tell)
  addEventListener('load', startReveal)
  startReveal()
  // Slidev. Its only sign is a meta in the head (<meta property=
  // "slidev:version">), and this script runs before the head is read, so the
  // meta is waited for as the parser adds it: Slidev's own module runs only
  // after the whole document is parsed, so the address can be set before it
  // starts. Its router reads the path, not the fragment, and sends '/' on to
  // '/1', so the page asked for is put into the path first.
  const startSlidev = () => {
    if (tool || !document.querySelector('meta[property="slidev:version"]')) return
    tool = {
      pageOf: () => slidevPageIn(location.pathname, location.hash),
      // Its router reads the path. Before it runs, the path is enough (it
      // sends '/' on to '/1', so the page asked for is set first); once it
      // runs, it is told of the new path as it is of the back button: an
      // event without a state of its own makes it go to the address.
      open: (page) => {
        history.replaceState(history.state, '', slidevPathOf(page) + location.search)
        dispatchEvent(new PopStateEvent('popstate', { state: null }))
      },
    }
    startTool()
  }
  const observer = new MutationObserver(() => {
    startSlidev()
    if (tool) observer.disconnect()
  })
  observer.observe(document, { childList: true, subtree: true })
  addEventListener('DOMContentLoaded', () => {
    startSlidev()
    observer.disconnect()
  })
  startSlidev()
  // suraido.js. Nothing in its built index.html says what made it, so it is
  // recognised once it runs, by what the deck itself sets: it writes its
  // scale to the root's own style as --suraido-scale when it fits itself to
  // the window, and its theme gives the root --suraido-fg and --suraido-bg.
  // Both are needed: a stylesheet or a script may name one by chance, and a
  // slide's own elements carry no mark of its name unless it uses the
  // built-in layout, so they are not looked at. It reads the fragment as a
  // number from 0 on start and on hashchange, so once it is recognised the
  // page asked for is put there, as a number from 0.
  const isSuraido = () => {
    const root = document.documentElement
    if (root.style.getPropertyValue('--suraido-scale').trim() === '') return false
    const style = getComputedStyle(root)
    return style.getPropertyValue('--suraido-fg').trim() !== '' && style.getPropertyValue('--suraido-bg').trim() !== ''
  }
  const startSuraido = () => {
    if (tool || !isSuraido()) return
    tool = {
      pageOf: () => suraidoPageIn(location.hash),
      open: (page) => {
        if (suraidoPageIn(location.hash) === page) return
        ours = suraidoHashOf(page)
        location.replace(location.pathname + location.search + ours)
      },
    }
    startTool()
  }
  const suraidoWatch = new MutationObserver(() => {
    startSuraido()
    if (tool) suraidoWatch.disconnect()
  })
  // The scale is written to the root's style, which is no change of its children.
  suraidoWatch.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
  // A stylesheet that loads after the page was built sets the properties.
  document.addEventListener('load', startSuraido, true)
  addEventListener('load', () => {
    startSuraido()
    suraidoWatch.disconnect()
  })
  // Each event carries its own address: two changes close together are two
  // events, and the document's address is already the later one. A hash this
  // script set for a tool is not a request of anyone's.
  addEventListener('hashchange', (event) => {
    if (new URL(event.newURL).hash === ours) ours = null
    tell()
  })
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
