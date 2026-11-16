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
 * belongs to the opening. The query never leaves the browser.
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

  const noticed = new Set()
  let waiting = []
  let timer = 0
  const post = (keepalive) => {
    clearTimeout(timer)
    timer = 0
    while (waiting.length > 0)
      fetch(${JSON.stringify(REPORT_PATH)}, {
        method: 'POST',
        keepalive,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ traffic: waiting.splice(0, ${TRAFFIC_PER_REQUEST}) }),
      }).catch(() => {})
  }
  const notice = (address, directive) => {
    let url
    try {
      url = new URL(address)
    } catch {
      return
    }
    if (!/^(https?|wss?):$/.test(url.protocol) || url.origin === location.origin) return
    const page = document.readyState === 'complete' ? (pageOf() ?? -1) : 0
    const item = { url: (url.origin + url.pathname).slice(0, 500), directive, page }
    const key = JSON.stringify(item)
    if (noticed.has(key) || noticed.size >= ${REPORTED_PER_VISIT}) return
    noticed.add(key)
    waiting.push(item)
    timer ||= setTimeout(post, ${REPORT_DELAY_MS}, false)
  }
  document.addEventListener('securitypolicyviolation', (event) => {
    if (event.disposition === 'report') notice(event.blockedURI, event.effectiveDirective)
  })
  for (const entry of performance.getEntriesByType('resource')) notice(entry.name, '')
  addEventListener('pagehide', () => post(true))
})()
`
