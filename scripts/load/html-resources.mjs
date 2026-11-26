// The files a browser would ask for after it receives an HTML page: what the
// load scripts fetch to behave like a reader. Pure: it reads text and a base
// address and returns addresses.

const ATTRIBUTES = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
const TAG = /<(img|script|link|source|audio|video)\b[^>]*>/gi

/** Whether a `link` tag loads something the page needs, not a link to follow. */
const loads = (tag) =>
  !/^<link\b/i.test(tag) ||
  /\brel\s*=\s*["']?(?:stylesheet|modulepreload|preload)\b/i.test(tag)

/** An attribute value as an http or https address without a fragment, or null. */
function resolved(value, base) {
  if (value === '' || value.startsWith('#')) return null
  let url
  try {
    url = new URL(value, base)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  url.hash = ''
  return url.href
}

/**
 * The addresses of the subresources an HTML text names, resolved against
 * `base`, in order and without repeats. Only http and https addresses count;
 * `data:` and `javascript:` addresses, fragments and mail links are skipped.
 * Anchors (`a href`) are not subresources and are not returned.
 *
 * @param {string} html
 * @param {string} base
 * @returns {string[]}
 */
export function subresources(html, base) {
  const found = new Set()
  for (const [tag] of html.matchAll(TAG)) {
    if (!loads(tag)) continue
    for (const match of tag.matchAll(ATTRIBUTES)) {
      const address = resolved((match[1] ?? match[2] ?? '').trim(), base)
      if (address) found.add(address)
    }
  }
  return [...found]
}

/**
 * The address of the first `iframe` in an HTML text, resolved against
 * `base`, or null: the viewer page frames the slides this way.
 *
 * @param {string} html
 * @param {string} base
 */
export function firstFrame(html, base) {
  for (const [tag] of html.matchAll(/<iframe\b[^>]*>/gi)) {
    const value = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)
    const text = value?.[1] ?? value?.[2]
    if (!text) continue
    try {
      return new URL(text, base).href
    } catch {
      return null
    }
  }
  return null
}
