import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'
import { accounts } from '../db/schema'
import { isUserId } from './face'
import { gravatarHash, isFresh } from './gravatar'
import { fetchGravatar } from './gravatar-client'
import {
  keepGravatar,
  readCachedGravatar,
  type CachedGravatar,
} from './gravatar-store'
import { readPictureObject, readPictureTime } from './picture-store'
import { readEmail, readGravatarChoice } from './store'

export const faceRoutes = new Hono<{ Bindings: Env }>()

/**
 * What every answer says: a picture is an image and nothing else. It may be
 * kept for a minute, which is how long another page may show the old one
 * after a change.
 */
const IMAGE_HEADERS = {
  'Cache-Control': 'public, max-age=60',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
} as const

/** A person with no picture, and a name that names nobody, answer the same. */
const noPicture = () =>
  new Response(null, { status: 404, headers: IMAGE_HEADERS })

const imageResponse = (body: BodyInit, contentType: string) =>
  new Response(body, {
    headers: { ...IMAGE_HEADERS, 'Content-Type': contentType },
  })

const fromKept = (kept: CachedGravatar) =>
  kept.picture
    ? imageResponse(kept.picture.body, kept.picture.contentType)
    : null

/**
 * The person's Gravatar picture, or null where there is none. An answer kept
 * within its time is used as it is. Otherwise Gravatar is asked, with the
 * hash of the address and nothing else, and what it said is kept. When it
 * cannot be reached, a picture kept earlier is used rather than none.
 */
async function gravatarFace(env: Env, userId: string) {
  const now = Math.floor(Date.now() / 1000)
  const kept = await readCachedGravatar(env.UPLOADS, userId)
  if (kept && isFresh(kept.kept, now)) return fromKept(kept)
  const email = await readEmail(env.DB, userId)
  if (!email) return null
  const answer = await fetchGravatar(await gravatarHash(email))
  await keepGravatar(env.UPLOADS, userId, answer, now)
  if (answer.kind === 'image')
    return imageResponse(answer.bytes as BodyInit, answer.contentType)
  return answer.kind === 'unreachable' && kept ? fromKept(kept) : null
}

/**
 * A person's picture, by their id (F28-AC49): the one they uploaded when
 * there is one, else their Gravatar picture unless they turned it off, else
 * none (404), which the page shows as their initial. The id is the service's own; the address it was made from is
 * never in the path, the answer or the headers.
 */
faceRoutes.get('/avatars/:userId', async (c) => {
  const userId = c.req.param('userId')
  if (!isUserId(userId)) return noPicture()
  const account = await drizzle(c.env.DB)
    .select({ id: accounts.user_id })
    .from(accounts)
    .where(eq(accounts.user_id, userId))
    .get()
  if (!account) return noPicture()
  if ((await readPictureTime(c.env.DB, userId)) !== null) {
    const stored = await readPictureObject(c.env.UPLOADS, userId)
    if (stored)
      return new Response(stored.body, {
        headers: {
          ...IMAGE_HEADERS,
          'Content-Type': stored.httpMetadata?.contentType ?? 'image/webp',
        },
      })
  }
  if (await readGravatarChoice(c.env.DB, userId))
    return (await gravatarFace(c.env, userId)) ?? noPicture()
  return noPicture()
})
