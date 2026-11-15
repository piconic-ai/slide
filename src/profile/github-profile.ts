/** GitHub serves every profile image from this origin. */
export const AVATAR_ORIGIN = 'https://avatars.githubusercontent.com'

const MAX_TEXT = 255
const MAX_URL = 2048

/**
 * A line of the profile, or null when it is empty or too long to show.
 * Control characters, a line break among them, are read as spaces.
 */
const line = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return text.length >= 1 && text.length <= MAX_TEXT ? text : null
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

/** The image's URL when GitHub serves it, so the page policy can allow it. */
export const avatarUrlOf = (value: unknown): string | null => {
  const url = typeof value === 'string' ? parseUrl(value) : null
  return url && url.origin === AVATAR_ORIGIN ? url.href : null
}

/**
 * The author's site as a link. GitHub keeps what the author typed, often
 * without a scheme, so a bare host is read as https. Only http and https
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

/** What the service shows of an author's GitHub profile. */
export type Profile = Readonly<{
  login: string
  name: string | null
  avatarUrl: string | null
  location: string | null
  website: string | null
}>

/**
 * Reads GitHub's answer for the signed-in user. Only the login is required;
 * anything else that is empty or not showable is left out, not refused.
 */
export function profileOfGitHub(login: string, data: unknown): Profile {
  const fields =
    typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>)
      : {}
  return {
    login,
    name: line(fields.name),
    avatarUrl: avatarUrlOf(fields.avatar_url),
    location: line(fields.location),
    website: websiteOf(fields.blog),
  }
}

/** The picture at the size an icon needs, in pixels of the image file. */
export const avatarAtSize = (avatarUrl: string, size: number): string => {
  const url = new URL(avatarUrl)
  url.searchParams.set('s', String(size))
  return url.href
}

export const githubUrl = (login: string) =>
  `https://github.com/${encodeURIComponent(login)}`
export const sponsorsUrl = (login: string) =>
  `https://github.com/sponsors/${encodeURIComponent(login)}`

/** A site's address as readers know it: the host, and a path when it has one. */
export const websiteLabel = (website: string) => {
  const url = new URL(website)
  return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
}
