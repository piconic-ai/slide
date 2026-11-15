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
