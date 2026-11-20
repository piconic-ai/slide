// The client of every service page: moves between pages inside the frame.
// Built with the components (vite.config.ts) as /components/assets/router.js,
// loaded by pageScripts after /share.js. See docs/dev/f03-sharing.md,
// "画面の移り方".
import { startRouter } from '@barefootjs/router'
import { BF_HOST, BF_SCOPE } from '@barefootjs/shared'
import { movesInFrame } from './router-policy'

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

startRouter({
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
    if (hasIslands(region)) {
      const runtime = await import('@barefootjs/client/runtime')
      runtime.rehydrateScope(region)
    }
    slidePage()?.mount(region)
  },
  dispose: async (region) => {
    if (hasIslands(region)) {
      const runtime = await import('@barefootjs/client/runtime')
      runtime.disposeScope(region)
    }
  },
})
