const MAX_URL = 2048

const MAX_BIO = 160
/** Only this much of a bio is read, however long GitHub's answer is. */
const MAX_BIO_READ = 2000

/**
 * The author's own words about themselves, as text. Only the start is read.
 * A lone surrogate becomes U+FFFD, every kind of line break becomes one
 * space, and control and format characters (direction marks, zero-width
 * characters) become spaces, so none can hide or reorder what is shown. The
 * text is then cut at 160 code points, with exactly 160 kept whole, no mark
 * on a cut one and no space left at its end.
 */
export const bioOf = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const text = Array.from(value)
    .slice(0, MAX_BIO_READ)
    .join('')
    .toWellFormed()
    .replace(/(?:\r\n|[\r\n\u0085\u2028\u2029])+/g, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .trim()
  const cut = Array.from(text).slice(0, MAX_BIO).join('').trimEnd()
  return cut || null
}

/** A URL short enough to keep, measured as it is written out. */
const parseUrl = (value: string): URL | null => {
  try {
    const url = new URL(value)
    return url.href.length <= MAX_URL ? url : null
  } catch {
    return null
  }
}

/**
 * The author's site as a link. A bare host is read as https. Only http and https
 * may be linked.
 */
export const websiteOf = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > MAX_URL) return null
  // Anything else that names a scheme fails as a host, or by its user part.
  const url = parseUrl(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  if (!url || !url.hostname.includes('.')) return null
  return url.username || url.password ? null : url.href
}

/** A site's address as readers know it: the host, and a path when it has one. */
export const websiteLabel = (website: string) => {
  const url = new URL(website)
  return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
}
