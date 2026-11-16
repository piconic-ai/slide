/** Where a slide loads the script that tells the viewer its page. */
export const PAGE_SCRIPT_PATH = '/_preview/pages.js'

/** The message a slide posts to the viewer when its page changes. */
export const PAGE_MESSAGE = 'slide:page'

/**
 * The script an author adds to a slide so the viewer knows which page is on
 * screen. A page is the number in the fragment, as Marp and peitho spell it
 * (`#6`); no fragment is the first page. Tools change the fragment through
 * the History API as well, which fires no event, so those calls are wrapped.
 * Only `viewerOrigin` is told, and only by the slide's own top document.
 */
export const pageScript = (viewerOrigin: string) => `(() => {
  if (parent === window || parent !== top) return
  const pageOf = () => {
    const spelled = /^#([1-9][0-9]{0,3})$/.exec(location.hash)
    return spelled ? Number(spelled[1]) : 1
  }
  let told = 0
  const tell = () => {
    const page = pageOf()
    if (page === told) return
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
  addEventListener('hashchange', tell)
  addEventListener('popstate', tell)
  tell()
})()
`
