import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'
import { accounts } from '../db/schema'
import { isUserId } from './face'
import { readPictureObject, readPictureTime } from './picture-store'

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

/**
 * A person's picture, by their id (F28-AC49): the one they uploaded when
 * there is one. The id is the service's own; the address it was made from is
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
  return noPicture()
})
