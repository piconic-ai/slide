import { z } from 'zod'

/**
 * Bumped whenever the image taken of the same deployment would change, so
 * old cache entries are never read again.
 */
export const COVER_SHOT_REVISION = 'v1'

/**
 * The same for the image of one page. Pages have a revision of their own,
 * so changing how a page is taken leaves every cover in the cache.
 */
export const PAGE_SHOT_REVISION = 'p1'

/** The last page taken as an image; later pages show the cover. */
export const MAX_SHOT_PAGE = 200

/**
 * How many pages of one deployment the browser is started for in a minute,
 * whoever asks: the limit of PAGE_SHOT_RATE_LIMITER in wrangler.jsonc. A
 * deployment has 200 page images, each with its own minute of remembering a
 * failure, so without it a deck that never settles could hold 200 browsers
 * a minute.
 */
export const PAGE_SHOTS_PER_MINUTE = 6

/** The key a deployment's new page images are counted under. */
export const pageShotBudgetKey = (deploymentId: string) =>
  `page-shots:${deploymentId}`

/** What one image shows: a deployment's first slide, or one of its pages. */
export type ShotTarget =
  | Readonly<{ kind: 'cover'; deploymentId: string }>
  | Readonly<{ kind: 'page'; deploymentId: string; page: number }>

const INTERNAL_HOST = 'https://cover-shots.internal'

/** The management path of a deployment's generated cover. */
export const coverShotPath = (deploymentId: string) =>
  `/covers/${deploymentId}.jpg`

/** The management path of the image of one page of a deployment. */
export const pageShotPath = (deploymentId: string, page: number) =>
  `/covers/${deploymentId}/${page}.jpg`

const deploymentIdSchema = z.uuid()

/** A page that may be taken, as a path spells it: 1 to MAX_SHOT_PAGE. */
function parseShotPage(segment: string | undefined): number | null {
  if (segment === undefined || !/^[1-9][0-9]{0,2}$/.test(segment)) return null
  const page = Number(segment)
  return page <= MAX_SHOT_PAGE ? page : null
}

/** The cover a cover path's last segment names, or null. */
export function parseCoverFile(file: string): ShotTarget | null {
  const id = /^(.+)\.jpg$/.exec(file)?.[1]
  const parsed = deploymentIdSchema.safeParse(id)
  return parsed.success ? { kind: 'cover', deploymentId: parsed.data } : null
}

/** The page the last two segments of a page image's path name, or null. */
export function parsePageFile(
  deployment: string,
  file: string,
): ShotTarget | null {
  const parsed = deploymentIdSchema.safeParse(deployment)
  const page = parseShotPage(/^(.+)\.jpg$/.exec(file)?.[1])
  return parsed.success && page !== null
    ? { kind: 'page', deploymentId: parsed.data, page }
    : null
}

/**
 * The internal URL of an image. Its path is the cache key. A deployment's
 * files never change, so neither do its cover and the images of its pages.
 */
export function shotUrl(target: ShotTarget): string {
  switch (target.kind) {
    case 'cover':
      return `${INTERNAL_HOST}/${COVER_SHOT_REVISION}/${target.deploymentId}`
    case 'page':
      return `${INTERNAL_HOST}/${PAGE_SHOT_REVISION}/${target.deploymentId}/${target.page}`
  }
}

/** Names the image taken, for a reader's revalidation. */
export function shotTag(target: ShotTarget): string {
  switch (target.kind) {
    case 'cover':
      return `cover-${COVER_SHOT_REVISION}-${target.deploymentId}`
    case 'page':
      return `page-${PAGE_SHOT_REVISION}-${target.deploymentId}-${target.page}`
  }
}

/** What an internal URL names, or null for any other URL. */
export function parseShotUrl(url: string): ShotTarget | null {
  const { origin, pathname, search } = new URL(url)
  if (origin !== INTERNAL_HOST || search) return null
  const [revision, id, page, ...rest] = pathname.slice(1).split('/')
  const parsed = deploymentIdSchema.safeParse(id)
  if (!parsed.success || rest.length) return null
  if (revision === COVER_SHOT_REVISION && page === undefined)
    return { kind: 'cover', deploymentId: parsed.data }
  const number = revision === PAGE_SHOT_REVISION ? parseShotPage(page) : null
  return number === null
    ? null
    : { kind: 'page', deploymentId: parsed.data, page: number }
}

/**
 * The address the browser opens under a deployment's origin. Decks that
 * page by number read it from the fragment, as the viewer hands it to them.
 */
export function shotLocation(target: ShotTarget): string {
  switch (target.kind) {
    case 'cover':
      return '/'
    case 'page':
      return `/#${target.page}`
  }
}

/**
 * How a slide is taken: a 16:9 screen as large as link previews show, once
 * the deck has loaded and its requests have settled. A deck that never
 * settles is refused instead of holding a browser.
 */
export const shotOptions = (deckUrl: string) =>
  ({
    url: deckUrl,
    viewport: { width: 1280, height: 720 },
    gotoOptions: { waitUntil: 'networkidle2', timeout: 15000 },
    screenshotOptions: { type: 'jpeg', quality: 85 },
  }) as const

/** What nothing may keep: the request named no deployment, or it is not public. */
export const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const

/**
 * How long the browser may work on one image, from opening the page to the
 * picture: the 15 seconds the page may take to settle, and a few more to
 * draw it. A deck that never answers the browser (a dialog, a loop that
 * never yields) is then given up on and its browser closed, instead of held
 * until puppeteer's own limit of minutes.
 */
export const SHOT_DEADLINE_MS = 20000

/** How long closing the browser may take before it is left to expire. */
export const CLOSE_DEADLINE_MS = 5000

/**
 * The browser could not be opened: the account's limit on new browsers was
 * reached, or the service failed. It says nothing about the deployment, so
 * nothing remembers it: the next request tries again, a few seconds later.
 */
export const BROWSER_BUSY_HEADERS = {
  'Cache-Control': 'no-store',
  'Retry-After': '5',
} as const

/**
 * A page refused for its deployment's budget was not tried, so nothing
 * remembers it: it is taken once the budget allows.
 */
export const OVER_BUDGET_HEADERS = NO_STORE_HEADERS

/**
 * A shot that failed is not taken again for a minute, so a deck that never
 * settles, or a browser over its budget, costs one attempt per minute
 * however often its cover is asked for.
 */
export const FAILED_SHOT_HEADERS = {
  'Cache-Control': 'public, max-age=60',
} as const

/**
 * A deployment's files never change, so an image taken of it may be kept
 * for good, under a tag that purges it together with the deployment.
 */
export const shotHeaders = (deploymentId: string) =>
  ({
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Cache-Tag': `deployment-${deploymentId}`,
  }) as const
