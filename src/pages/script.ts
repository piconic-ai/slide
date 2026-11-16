import { REPORT_PATH, TRAFFIC_PER_REQUEST } from '../safety/traffic'

/** Where a slide loads the script that tells the viewer its page. */
export const PAGE_SCRIPT_PATH = '/_preview/pages.js'

/** The message a slide posts to the viewer when its page changes. */
export const PAGE_MESSAGE = 'slide:page'
/** The viewer's question, for a viewer that started listening late. */
export const PAGE_REQUEST = 'slide:page-request'

/** URLs one visit reports, so a slide that never stops cannot post forever. */
const REPORTED_PER_VISIT = 500
/** How long noticed traffic waits for more before it is posted. */
const REPORT_DELAY_MS = 500

/**
 * The script an author adds to a slide so the viewer knows which page is on
 * screen. A page is the number in the fragment, as Marp and peitho spell it
 * (`#6`); no fragment is the first page. A fragment that is not a page
 * number, such as a heading's or another tool's spelling, tells nothing:
 * guessing the first page would move the reader's address off their page.
 * Tools change the fragment through
 * the History API as well, which fires no event, so those calls are wrapped.
 * Only `viewerOrigin` is told, and only by the slide's own top document.
 * The viewer may start listening after the slide has told its page, so it
 * asks once it does, and the page is told again.
 *
 * It also posts, to the slide's own origin, what the report-only policy
 * noticed the slide reach on other hosts, with the page on screen: 0 until
 * the slide has loaded, and unknown where the fragment is no page. A
 * browser posts its own reports one request each and stops after about a
 * hundred, so these go several to a request. What loaded before this script
 * ran fired no event here; it is posted without a kind, only to say that it
 * belongs to the opening. What this script posts carries no query.
 */
export const pageScript = (viewerOrigin: string) => `(() => {
  if (parent === window || parent !== top) return
  const pageOf = () => {
    if (location.hash === '' || location.hash === '#') return 1
    const spelled = /^#([1-9][0-9]{0,3})$/.exec(location.hash)
    return spelled ? Number(spelled[1]) : null
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
  addEventListener('message', (event) => {
    if (event.source !== parent || event.origin !== ${JSON.stringify(viewerOrigin)}) return
    if (event.data?.type !== ${JSON.stringify(PAGE_REQUEST)}) return
    told = 0
    tell()
  })
  addEventListener('hashchange', tell)
  addEventListener('popstate', tell)
  tell()

  // Kept from the start, so a slide that replaces fetch later changes nothing.
  const send = fetch
  // Spelled in full: a base element the slides add later points elsewhere.
  const reportTo = location.origin + ${JSON.stringify(REPORT_PATH)}
  const started = performance.now()
  // The opening lasts through the load handlers and what they start.
  let opening = document.readyState !== 'complete'
  addEventListener('load', () => setTimeout(() => { opening = false }, 0))
  const noticed = new Set()
  let waiting = []
  let timer = 0
  const post = (keepalive) => {
    clearTimeout(timer)
    timer = 0
    while (waiting.length > 0) {
      const body = JSON.stringify({ traffic: waiting.splice(0, ${TRAFFIC_PER_REQUEST}) })
      try {
        send(reportTo, {
          method: 'POST',
          keepalive,
          headers: { 'Content-Type': 'application/json' },
          body,
        }).catch(() => {})
      } catch {}
    }
  }
  const notice = (address, directive, page) => {
    let url
    try {
      url = new URL(address)
    } catch {
      return
    }
    if (!/^(https?|wss?):$/.test(url.protocol) || url.origin === location.origin) return
    // An address that stops at its host has no path to tell.
    const path = /^[a-z][a-z0-9+.-]*:\\/\\/[^/?#]*$/i.test(address) ? '' : url.pathname
    const item = { url: (url.origin + path).slice(0, 500), directive, page }
    const key = JSON.stringify(item)
    if (noticed.has(key) || noticed.size >= ${REPORTED_PER_VISIT}) return
    noticed.add(key)
    waiting.push(item)
    if (!timer) timer = setTimeout(post, ${REPORT_DELAY_MS}, false)
  }
  document.addEventListener('securitypolicyviolation', (event) => {
    if (event.disposition !== 'report') return
    notice(event.blockedURI, event.effectiveDirective, opening ? 0 : (pageOf() ?? -1))
  })
  // What began loading before this script ran fired its event unheard. Its
  // entry appears once it has loaded, which may be after this script.
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if (entry.startTime < started) notice(entry.name, '', 0)
    }).observe({ type: 'resource', buffered: true })
  } catch {}
  addEventListener('pagehide', () => post(true))
  // A phone may never fire pagehide.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') post(true)
  })
})()
`
