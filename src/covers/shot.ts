import { z } from 'zod'

/**
 * Bumped whenever the image taken of the same deployment would change, so
 * old cache entries are never read again.
 */
export const COVER_SHOT_REVISION = 'v1'

const INTERNAL_HOST = 'https://cover-shots.internal'

/** The management path of a deployment's generated cover. */
export const coverShotPath = (deploymentId: string) =>
  `/covers/${deploymentId}.jpg`

const deploymentIdSchema = z.uuid()

/** The deployment a cover path's last segment names, or null. */
export function parseCoverFile(file: string): string | null {
  const id = /^(.+)\.jpg$/.exec(file)?.[1]
  const parsed = deploymentIdSchema.safeParse(id)
  return parsed.success ? parsed.data : null
}

/**
 * The internal URL of a deployment's cover. Its path is the cache key. A
 * deployment's files never change, so neither does its cover.
 */
export const coverShotUrl = (deploymentId: string) =>
  `${INTERNAL_HOST}/${COVER_SHOT_REVISION}/${deploymentId}`

/** Names the image taken of a deployment, for a reader's revalidation. */
export const coverTag = (deploymentId: string) =>
  `cover-${COVER_SHOT_REVISION}-${deploymentId}`

/** The deployment an internal URL names, or null for any other URL. */
export function parseCoverShotUrl(url: string): string | null {
  const { origin, pathname, search } = new URL(url)
  if (origin !== INTERNAL_HOST || search) return null
  const parts = pathname.slice(1).split('/')
  if (parts.length !== 2 || parts[0] !== COVER_SHOT_REVISION) return null
  const parsed = deploymentIdSchema.safeParse(parts[1])
  return parsed.success ? parsed.data : null
}

/**
 * How the first slide is taken: a 16:9 screen as large as link previews
 * show, once the deck has loaded and its requests have settled. A deck that
 * never settles is refused instead of holding a browser.
 */
export const shotOptions = (deckUrl: string) =>
  ({
    url: deckUrl,
    viewport: { width: 1280, height: 720 },
    gotoOptions: { waitUntil: 'networkidle2', timeout: 15000 },
    screenshotOptions: { type: 'jpeg', quality: 85 },
  }) as const

/** Whether the browser answered with the image, and nothing else. */
export const isJpegShot = (ok: boolean, contentType: string | null) =>
  ok && contentType === 'image/jpeg'

/** What nothing may keep: the request named no deployment, or it is not public. */
export const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const

/**
 * A shot that failed is not taken again for a minute, so a deck that never
 * settles, or a browser over its budget, costs one attempt per minute
 * however often its cover is asked for.
 */
export const FAILED_SHOT_HEADERS = {
  'Cache-Control': 'public, max-age=60',
} as const

/**
 * A deployment's files never change, so its cover may be kept for good,
 * under a tag that purges it together with the deployment.
 */
export const shotHeaders = (deploymentId: string) =>
  ({
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Cache-Tag': `deployment-${deploymentId}`,
  }) as const
