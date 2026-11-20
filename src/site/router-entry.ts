// The client of every service page: moves between pages inside the frame.
// Built with the components (vite.config.ts) as /components/assets/router.js,
// loaded by pageScripts after /share.js. See docs/dev/f03-sharing.md,
// "画面の移り方".
import { startRouter } from '@barefootjs/router'
import { BF_HOST, BF_SCOPE } from '@barefootjs/shared'
import { movesInFrame, policyCovers, regionHasForm } from './router-policy'

/**
 * What /share.js offers to the scripts that bind to the page's own markup:
 * `mount` binds what a move put in the frame. A page loaded whole is bound
 * by the scripts themselves.
 */
type SlidePage = { mount: (region: Element) => void }

const slidePage = () =>
  (window as unknown as { slidePage?: SlidePage }).slidePage

/** Whether a region holds components that were compiled with hydration. */
const hasIslands = (region: Element) =>
  region.hasAttribute(BF_SCOPE) ||
  region.hasAttribute(BF_HOST) ||
  region.querySelector(`[${BF_SCOPE}],[${BF_HOST}]`) !== null

/**
 * The policy of the page on screen, which a page moved in runs under. It is
 * asked for once, by a request that reads no body, and after that it is the
 * policy of the page last moved in. Null where it is not known.
 */
let here: string | null | undefined
const policyOfPageOnScreen = async () => {
  try {
    const response = await window.fetch(location.href, { method: 'HEAD' })
    return response.headers.get('Content-Security-Policy')
  } catch {
    return null
  }
}
/** What the pages asked for said about themselves, until one is moved in. */
const policies = new Map<string, string>()
const withoutHash = (href: string) => href.split('#')[0] ?? href

startRouter({
  // A page moved in runs under the policy of the page before it, so a page
  // that needs more than that (a form, where the page before allows none) is
  // not moved in: the answer is refused, and the router loads it whole.
  fetch: async (input, init) => {
    const response = await window.fetch(input, init)
    if (!response.ok) return response
    const incoming = response.headers.get('Content-Security-Policy')
    here ??= await policyOfPageOnScreen()
    const hasForm = regionHasForm(await response.clone().text())
    if (
      incoming === null ||
      here === null ||
      !policyCovers(here, incoming, hasForm)
    )
      return new Response(null, { status: 409 })
    policies.set(withoutHash(response.url), incoming)
    return response
  },
  shouldIntercept: (link) =>
    movesInFrame({
      href: link.href,
      from: location.href,
      router: link.dataset.bfRouter,
      download: link.hasAttribute('download'),
      target: link.getAttribute('target'),
      rel: link.getAttribute('rel'),
    }),
  // Nothing is fetched ahead of a click: a page may answer for the one who
  // asks (an author's own slides start a one-time session when read), and
  // a page kept for a few seconds could outlive what it showed.
  prefetch: false,
  cacheFreshMs: 0,
  cacheStaleMs: 0,
  // The client runtime is the one the components were built against; it is
  // loaded only when the page that moved in has components.
  rehydrate: async (region) => {
    here = policies.get(withoutHash(location.href)) ?? null
    if (hasIslands(region)) {
      const runtime = await import('@barefootjs/client/runtime')
      runtime.rehydrateScope(region)
    }
    slidePage()?.mount(region)
    // A viewer takes the focus into its slides, as it does when loaded whole;
    // the router moves the focus to the heading after this returns, so the
    // slides take it back after that.
    const slides = region.querySelector<HTMLElement>('iframe[data-autofocus]')
    if (slides) setTimeout(() => slides.focus(), 0)
  },
  dispose: async (region) => {
    if (hasIslands(region)) {
      const runtime = await import('@barefootjs/client/runtime')
      runtime.disposeScope(region)
    }
  },
})
