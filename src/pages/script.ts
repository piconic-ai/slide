import { GESTURE_SOURCE } from './gesture'
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
  if (parent === window) return
  // Only the viewer is told of pages, and asks; a frame in the embed page
  // (which another site holds) is not its to tell, but still gets the
  // gestures below.
  const viewed = parent === top
  ${STORED_AT_PLACEHOLDER}
  ${READING_SOURCE}
  ${GESTURE_SOURCE}
  // What a slide tool shows, once the script has recognised the tool by its
  // own API (see the readers below). Until then, and for slides of no known
  // tool, the page is what the address says.
  let tool = null
  const pageOf = () => tool ? tool.pageOf() : pageIn(location.search, location.hash)
  // The page the reader was sent to, as the address said when this ran.
  const requested = requestedIn(location.hash)
  let told = 0
  const tell = () => {
    if (!viewed) return
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
    if (!viewed) return
    if (storedAt > 0) parent.postMessage({ type: ${JSON.stringify(OFFLINE_MESSAGE.stored)}, at: storedAt }, ${JSON.stringify(viewerOrigin)})
  }
  if (viewed) addEventListener('message', (event) => {
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
    }
    const slide = requested === null ? null : slideOfPage(columnsOf(), requested)
    if (slide) {
      // Without the slides' move from one to another, which would show, and
      // at the first step of the slide: going back to a slide, reveal.js
      // shows all its fragments unless told which one.
      const slides = document.querySelector('.reveal .slides')
      slides.classList.add('no-transition')
      deck.slide(slide.h, slide.v, -1)
      void slides.offsetWidth
      slides.classList.remove('no-transition')
    }
    tell()
  }
  // Turning pages by touch, for slides that only know the keyboard. Touches
  // reach this window because the viewer (and the embed page) make the
  // frame count as having a touch handler, which iOS Safari asks for. A
  // tap is read from the touches: iOS gives no click to a window. The turn
  // is the key the slides already answer to, sent after they have had a
  // moment to turn the page themselves, so slides with a touch of their own
  // are not turned twice.
  let touch = null
  let spoiled = false
  let latched = false
  const chainOf = (element) => {
    const chain = []
    for (let at = element; at instanceof Element; at = at.parentElement) {
      const style = getComputedStyle(at)
      chain.push({
        tag: at.localName,
        role: at.getAttribute('role'),
        onclick: at.hasAttribute('onclick'),
        editable: at.isContentEditable,
        pointer: style.cursor === 'pointer',
        scrollsX: at.scrollWidth > at.clientWidth + 1 && (style.overflowX === 'auto' || style.overflowX === 'scroll'),
      })
    }
    return chain
  }
  const zoomed = () => !!window.visualViewport && window.visualViewport.scale > 1.01
  const selecting = () => String(getSelection() ?? '') !== ''
  const press = (turn) => {
    const { key, code, keyCode } = keyOf(turn)
    const event = new KeyboardEvent('keydown', { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true })
    // An engine that leaves the legacy codes out of the init is given them.
    if (event.keyCode !== keyCode) Object.defineProperty(event, 'keyCode', { value: keyCode })
    if (event.which !== keyCode) Object.defineProperty(event, 'which', { value: keyCode })
    ;(document.body ?? document.documentElement).dispatchEvent(event)
  }
  addEventListener('touchstart', (event) => {
    spoiled = event.touches.length > 1
    const first = event.changedTouches[0]
    touch = spoiled || !first ? null : { x: first.clientX, y: first.clientY, t: event.timeStamp, page: pageOf(), element: event.target }
  }, { passive: true })
  addEventListener('touchcancel', () => {
    touch = null
    spoiled = false
  }, { passive: true })
  addEventListener('touchend', (event) => {
    const began = touch
    const alone = !spoiled && event.touches.length === 0
    touch = null
    if (event.touches.length === 0) spoiled = false
    else spoiled = true
    const last = event.changedTouches[0]
    if (!began || !alone || !last) return
    const gesture = gestureOf(began, { x: last.clientX, y: last.clientY, t: event.timeStamp }, innerWidth)
    if (!gesture || zoomed() || selecting()) return
    const chain = chainOf(began.element)
    if (gesture.tap ? tappedForItself(chain) : scrollsAcross(chain)) return
    if (!mayTurn(tool, began.page, latched)) return
    setTimeout(() => {
      if (afterSettling(began.page, pageOf()) === 'send') press(gesture.turn)
      else latched = true
    }, SETTLE_MS)
  }, { passive: true })
  document.addEventListener('ready', startReveal)
  document.addEventListener('slidechanged', tell)
  addEventListener('load', startReveal)
  startReveal()
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
