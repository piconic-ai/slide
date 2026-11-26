// Checks made after a release reaches production, with no login: the pages
// anyone can open open, and the doors that must stay shut stay shut. Pure
// apart from the `send` it is given (the platform's `fetch` with a time limit,
// see release-fetch.mjs; a test hands in its own), so no check here reaches
// the network by itself. docs/dev/release-flow.md
// (REL-AC8, REL-AC9) lists the checks; docs/dev/deploy.md says what is left
// for a person.

/** A deployment that never exists: its origin must answer 404. */
const MISSING_DEPLOYMENT = 'd-00000000-0000-4000-8000-000000000000'

/** What a closed door answers by refusing. */
const REFUSED = new Set([401, 403, 404])
/** A redirect is a closed door only when it leads to Cloudflare Access's login. */
const REDIRECTED = new Set([301, 302, 303, 307, 308])

/**
 * @typedef {{ name: string, state: 'ok' | 'failed' | 'skipped', detail: string }} CheckResult
 * @typedef {{ site: URL, content: URL, admin: URL, accessTeam: URL | null }} Origins
 */

/**
 * Reads an origin given as text. Only an origin is accepted: https, or http
 * for a machine's own address (a local start), and nothing after the host.
 * Returns null for anything else, so a mistaken argument checks nothing.
 */
export function parseOrigin(value) {
  if (typeof value !== 'string') return null
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const scheme =
    url.protocol === 'https:' || (loopback && url.protocol === 'http:')
  const bare =
    url.pathname === '/' &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password
  return scheme && bare ? new URL(url.origin) : null
}

/** The host a content origin's deployments hang from, `d-<id>.<host>`. */
const deploymentOrigin = (content, label) =>
  new URL(`${content.protocol}//${label}.${content.host}/`)

/** The management host does not exist on the content domain: `www.<host>`. */
const wwwOrigin = (content) =>
  new URL(`${content.protocol}//www.${content.host}/`)

/**
 * One request that never throws and never follows a redirect: the answer's
 * status and headers, or a failure with a reason that names no address.
 */
async function get(send, url) {
  try {
    const response = await send(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'slide-post-deploy-check' },
    })
    return { ok: true, response }
  } catch (error) {
    const timeout = error instanceof Error && error.name === 'TimeoutError'
    return { ok: false, reason: timeout ? 'timeout' : 'network error' }
  }
}

const result = (name, ok, detail) => ({
  name,
  state: ok ? 'ok' : 'failed',
  detail,
})

/** A page that must answer 200 with a given kind of content. */
async function pageOpens(send, name, url, type) {
  const answer = await get(send, url)
  if (!answer.ok) return result(name, false, answer.reason)
  const { status, headers } = answer.response
  const kind = headers.get('content-type') ?? ''
  if (status !== 200) return result(name, false, `status ${status}`)
  if (!kind.startsWith(type))
    return result(name, false, 'unexpected content type')
  return result(name, true, 'status 200')
}

/** A request that must answer one given status. */
async function answers(send, name, url, expected) {
  const answer = await get(send, url)
  if (!answer.ok) return result(name, false, answer.reason)
  const { status } = answer.response
  return result(name, status === expected, `status ${status}`)
}

/**
 * The operator host must not open to a request without Cloudflare Access. It
 * answers a refusal, or a redirect whose Location is on the Access team's own
 * host (the login). A redirect anywhere else, to no place, or with no team
 * known, is not a closed door: it could lead anywhere.
 */
async function adminStaysClosed(send, admin, accessTeam) {
  const name = 'admin origin is closed outside Access'
  const answer = await get(send, admin)
  if (!answer.ok) return result(name, false, answer.reason)
  const { status, headers } = answer.response
  if (REFUSED.has(status)) return result(name, true, `status ${status}`)
  if (!REDIRECTED.has(status)) return result(name, false, `status ${status}`)
  const leadsToAccess =
    accessTeam && redirectHost(headers, admin) === accessTeam.host
  return result(
    name,
    Boolean(leadsToAccess),
    leadsToAccess ? `status ${status}` : `status ${status}, not to Access`,
  )
}

/** The host a redirect leads to, or null when it has no usable Location. */
function redirectHost(headers, base) {
  const location = headers.get('location')
  if (!location) return null
  try {
    return new URL(location, base).host
  } catch {
    return null
  }
}

/** The first iframe address of a viewer page, or null. */
const frameSource = (html) =>
  /<iframe\b[^>]*?\ssrc="([^"]+)"/i.exec(html)?.[1] ?? null

/**
 * One public slide, found through the top page's own list: its viewer opens,
 * and the origin of its version serves it. With no public slide there is
 * nothing to open: both are skipped, which is said, not hidden.
 */
async function publicSlide(send, site, content) {
  const list = 'public slide list'
  const viewer = 'public slide viewer'
  const served = 'public slide is served from its content origin'
  const listed = await get(send, new URL('/api/public/slides', site))
  if (!listed.ok) return fail3(list, viewer, served, listed.reason)
  if (listed.response.status !== 200)
    return fail3(list, viewer, served, `status ${listed.response.status}`)
  let slides
  try {
    slides = await listed.response.json()
  } catch {
    return fail3(list, viewer, served, 'not JSON')
  }
  if (!Array.isArray(slides)) return fail3(list, viewer, served, 'not a list')
  if (slides.length === 0)
    return [
      result(list, true, 'no public slide'),
      { name: viewer, state: 'skipped', detail: 'no public slide' },
      { name: served, state: 'skipped', detail: 'no public slide' },
    ]
  const href = slides[0]?.href
  if (typeof href !== 'string' || !/^\/@[^/\s]+\/[^/\s]+$/.test(href))
    return fail3(list, viewer, served, 'unexpected entry')
  const page = await get(send, new URL(href, site))
  if (!page.ok)
    return [result(list, true, 'ok'), ...fail2(viewer, served, page.reason)]
  if (page.response.status !== 200)
    return [
      result(list, true, 'ok'),
      ...fail2(viewer, served, `status ${page.response.status}`),
    ]
  const source = frameSource(await page.response.text())
  let frame = null
  try {
    frame = source ? new URL(source) : null
  } catch {
    frame = null
  }
  if (
    !frame ||
    frame.origin === site.origin ||
    !frame.host.endsWith(`.${content.host}`)
  )
    return [
      result(list, true, 'ok'),
      result(viewer, false, 'no frame on the content origin'),
      result(served, false, 'not run'),
    ]
  const frameAnswer = await answers(send, served, frame, 200)
  return [
    result(list, true, 'ok'),
    result(viewer, true, 'status 200'),
    frameAnswer,
  ]
}

const fail3 = (a, b, c, detail) => [
  result(a, false, detail),
  result(b, false, 'not run'),
  result(c, false, 'not run'),
]
const fail2 = (a, b, detail) => [
  result(a, false, detail),
  result(b, false, 'not run'),
]

/**
 * Runs every check, in a fixed order, and returns each result. Nothing here
 * stops at the first failure: the report names every item that failed.
 * @param {Origins} origins
 * @param {typeof fetch} send
 * @returns {Promise<CheckResult[]>}
 */
export async function runPostDeployChecks(origins, send) {
  const { site, content, admin, accessTeam } = origins
  const at = (path) => new URL(path, site)
  return [
    await pageOpens(send, 'top page', at('/'), 'text/html'),
    await pageOpens(send, 'robots.txt', at('/robots.txt'), 'text/plain'),
    await pageOpens(send, 'terms', at('/terms'), 'text/html'),
    await pageOpens(send, 'privacy policy', at('/privacy'), 'text/html'),
    await pageOpens(
      send,
      'external transmissions',
      at('/privacy/external'),
      'text/html',
    ),
    await pageOpens(send, 'help', at('/help'), 'text/html'),
    await pageOpens(send, 'login', at('/login'), 'text/html'),
    await answers(send, 'slide list needs login', at('/api/slides'), 401),
    ...(await publicSlide(send, site, content)),
    await answers(
      send,
      'unknown deployment origin is missing',
      deploymentOrigin(content, MISSING_DEPLOYMENT),
      404,
    ),
    await answers(
      send,
      'content domain serves no management page',
      new URL('/slides', wwwOrigin(content)),
      404,
    ),
    await adminStaysClosed(send, admin, accessTeam),
  ]
}

/** The names of the checks that failed. A skipped check did not fail. */
export const failedChecks = (results) =>
  results.filter((one) => one.state === 'failed').map((one) => one.name)

/** One line per check, for the build log. Holds no address and no header. */
export const checkLines = (results) =>
  results.map((one) => `${one.state.padEnd(7)} ${one.name}: ${one.detail}`)
