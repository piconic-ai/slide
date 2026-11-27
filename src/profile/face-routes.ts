import { Hono, type Context } from 'hono'
import {
  faceCacheControl,
  facePictureUrl,
  isUserId,
  type FaceFacts,
  type FaceSource,
} from './face'
import { gravatarHash, isFresh } from './gravatar'
import { fetchGravatar } from './gravatar-client'
import {
  keepGravatar,
  readCachedGravatar,
  type CachedGravatar,
} from './gravatar-store'
import { serveFacePicture } from './face-picture-store'
import { servedPictureType } from './picture-policy'
import { markGravatarAsked, readEmail, readFaceFacts } from './store'

export const faceRoutes = new Hono<{ Bindings: Env }>()

/**
 * What every answer says: a picture is an image and nothing else. How long
 * it may be kept depends on the address it was asked for (`faceCacheControl`).
 */
const IMAGE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
} as const

/** A picture to serve, and the face it is the picture of. */
type Served = Readonly<{
  body: BodyInit
  contentType: string
  source: FaceSource
  /** The edge cache's answer (`HIT`, `MISS`), or `none` when it was not asked. */
  edgeCache: string
}>

/** A person with no picture, and a name that names nobody, answer the same. */
const noPicture = () =>
  new Response(null, {
    status: 404,
    headers: {
      ...IMAGE_HEADERS,
      'Cache-Control': faceCacheControl('', null, 0),
    },
  })

const fromKept = (kept: CachedGravatar): Served | null =>
  kept.picture
    ? {
        body: kept.picture.body,
        contentType: kept.picture.contentType,
        source: { kind: 'gravatar', at: kept.kept.at },
        edgeCache: 'none',
      }
    : null

/**
 * The person's Gravatar picture, or null where there is none. An answer kept
 * within its time is used as it is. Otherwise Gravatar is asked, with the
 * hash of the address and nothing else, and what it said is kept, with the
 * time it was asked noted in D1 for the picture's address. When it cannot be
 * reached, a picture kept earlier is used rather than none.
 */
async function gravatarFace(
  env: Env,
  userId: string,
  notedAt: number | null,
): Promise<Served | null> {
  const now = Math.floor(Date.now() / 1000)
  const kept = await readCachedGravatar(env.UPLOADS, userId)
  if (kept && isFresh(kept.kept, now)) {
    // A time D1 missed (an answer kept before it noted times) is noted now.
    if (kept.kept.at !== notedAt)
      await markGravatarAsked(env.DB, userId, kept.kept.at)
    return fromKept(kept)
  }
  const email = await readEmail(env.DB, userId)
  if (!email) return null
  const answer = await fetchGravatar(await gravatarHash(email))
  if (answer.kind === 'unreachable') return kept ? fromKept(kept) : null
  await keepGravatar(env.UPLOADS, userId, answer, now)
  await markGravatarAsked(env.DB, userId, now)
  return answer.kind === 'image'
    ? {
        body: answer.bytes as BodyInit,
        contentType: answer.contentType,
        source: { kind: 'gravatar', at: now },
        edgeCache: 'none',
      }
    : null
}

/** The cached entrypoint, or undefined where there is none (as in tests). */
const cachedPictures = (c: Context) => {
  try {
    return (c.executionCtx as unknown as ExecutionContext).exports?.FacePictures
  } catch {
    return undefined
  }
}

/**
 * The picture the person uploaded, or null when its object is not there.
 * D1 has already said which upload is current, so the bytes come from the
 * internal cache under that upload's own key. Without the cached entrypoint
 * the object is read each time.
 */
async function uploadedFace(
  env: Env,
  pictures: ReturnType<typeof cachedPictures>,
  userId: string,
  at: number,
): Promise<Served | null> {
  const internal = new Request(facePictureUrl(userId, at))
  const stored = await (pictures
    ? pictures.fetch(internal)
    : serveFacePicture(env.UPLOADS, internal))
  if (!stored.ok) {
    await stored.body?.cancel()
    return null
  }
  return {
    body: stored.body ?? '',
    contentType: servedPictureType(
      stored.headers.get('Content-Type') ?? undefined,
    ),
    source: { kind: 'uploaded', at },
    edgeCache: stored.headers.get('Cf-Cache-Status') ?? 'none',
  }
}

/**
 * The person's face, in the order D-31 sets: the uploaded picture, else the
 * Gravatar picture unless they turned it off, else none. An uploaded row
 * whose object is missing goes on to the next.
 */
async function servedFace(
  env: Env,
  pictures: ReturnType<typeof cachedPictures>,
  userId: string,
  facts: FaceFacts,
): Promise<Served | null> {
  const uploaded =
    facts.uploadedAt === null
      ? null
      : await uploadedFace(env, pictures, userId, facts.uploadedAt)
  if (uploaded) return uploaded
  return facts.useGravatar ? gravatarFace(env, userId, facts.gravatarAt) : null
}

/**
 * A person's picture, by their id (F28-AC49): the one they uploaded when
 * there is one, else their Gravatar picture unless they turned it off, else
 * none (404), which the page shows as their initial. The id is the
 * service's own; the address it was made from is never in the path, the
 * answer or the headers. The `v` in the address is the face's version
 * (`facePath`); only a picture asked for under its own version is kept long.
 */
faceRoutes.get('/avatars/:userId', async (c) => {
  const userId = c.req.param('userId')
  if (!isUserId(userId)) return noPicture()
  const facts = await readFaceFacts(c.env.DB, userId)
  const served = facts
    ? await servedFace(c.env, cachedPictures(c), userId, facts)
    : null
  if (!served) return noPicture()
  return new Response(served.body, {
    headers: {
      ...IMAGE_HEADERS,
      'Content-Type': served.contentType,
      // Shows whether the bytes came from the edge cache, for operators.
      'X-Content-Cache': served.edgeCache,
      'Cache-Control': faceCacheControl(
        c.req.query('v'),
        served.source,
        Math.floor(Date.now() / 1000),
      ),
    },
  })
})
