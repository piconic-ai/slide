import { z } from 'zod'

/** A Bluesky account's permanent identifier. */
export const didSchema = z
  .string()
  .regex(/^did:(?:plc:[a-z2-7]{24}|web:[a-z0-9.-]{1,253})$/, 'Invalid DID')

const X_HOSTS: ReadonlySet<string> = new Set([
  'x.com',
  'www.x.com',
  'mobile.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
])
const X_PATH = /^\/(?:[A-Za-z0-9_]{1,15}|i\/web|i)\/status\/([0-9]{1,20})\/?$/
const BLUESKY_PATH =
  /^\/profile\/([A-Za-z0-9.:-]{1,253})\/post\/([A-Za-z0-9._~-]{1,64})\/?$/
const BLUESKY_HANDLE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * A post as its URL names it. A Bluesky URL may name the author by handle,
 * which has to be resolved to a DID before the post can be stored or shown.
 */
export type PostLink =
  | Readonly<{ service: 'x'; id: string }>
  | Readonly<{
      service: 'bluesky'
      actor:
        | Readonly<{ kind: 'did'; did: string }>
        | Readonly<{ kind: 'handle'; handle: string }>
      rkey: string
    }>

/** A post that can be stored and embedded. */
export type Post =
  | Readonly<{ service: 'x'; id: string }>
  | Readonly<{ service: 'bluesky'; did: string; rkey: string }>

/** Reads the URL of a post on X or Bluesky, or null for anything else. */
export function parsePostUrl(input: string): PostLink | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    return null
  if (X_HOSTS.has(url.hostname)) {
    const id = X_PATH.exec(url.pathname)?.[1]
    // IDs are decimal without padding, so one post has one spelling.
    return id && !id.startsWith('0') ? { service: 'x', id } : null
  }
  if (url.hostname !== 'bsky.app') return null
  const match = BLUESKY_PATH.exec(url.pathname)
  const [actor, rkey] = [match?.[1], match?.[2]]
  if (!actor || !rkey) return null
  if (didSchema.safeParse(actor).success)
    return { service: 'bluesky', actor: { kind: 'did', did: actor }, rkey }
  const handle = actor.toLowerCase()
  return BLUESKY_HANDLE.test(handle)
    ? { service: 'bluesky', actor: { kind: 'handle', handle }, rkey }
    : null
}

/** The key that names a post within its service. */
export const postKey = (post: Post) =>
  post.service === 'x' ? post.id : `${post.did}/${post.rkey}`

/** Reads a stored key back; null when the stored data is not a post. */
export function postOfKey(service: 'x' | 'bluesky', key: string): Post | null {
  if (service === 'x')
    return /^[1-9][0-9]{0,19}$/.test(key) ? { service, id: key } : null
  const [did, rkey, ...rest] = key.split('/')
  return did &&
    rkey &&
    !rest.length &&
    didSchema.safeParse(did).success &&
    /^[A-Za-z0-9._~-]{1,64}$/.test(rkey)
    ? { service, did, rkey }
    : null
}

/** The page of a post on its own service. */
export const postUrl = (post: Post) =>
  post.service === 'x'
    ? `https://x.com/i/status/${post.id}`
    : `https://bsky.app/profile/${post.did}/post/${post.rkey}`

/** The origins the services serve their embeds from. */
export const EMBED_ORIGINS = {
  x: 'https://platform.twitter.com',
  bluesky: 'https://embed.bsky.app',
} as const

/** The service's own embed page for a post, shown in a frame. */
export const embedUrl = (post: Post) =>
  post.service === 'x'
    ? `${EMBED_ORIGINS.x}/embed/Tweet.html?id=${post.id}&dnt=true`
    : `${EMBED_ORIGINS.bluesky}/embed/${post.did}/app.bsky.feed.post/${post.rkey}`

const X_EPOCH_MS = 1288834974657n
const SORTABLE = '234567abcdefghijklmnopqrstuvwxyz'
/** Posts cannot be older than the services' ID schemes or from the far future. */
const EARLIEST_SECONDS = 1288834974
const LATEST_SECONDS = 4102444800

const plausible = (seconds: number) =>
  seconds > EARLIEST_SECONDS && seconds < LATEST_SECONDS ? seconds : null

/**
 * When a post was made, in seconds since the epoch, as its ID tells it: an X
 * status ID and a Bluesky record key both begin with a timestamp. Null for
 * IDs from before those schemes, or keys that are not timestamps.
 */
export function postedAtOf(post: Post): number | null {
  if (post.service === 'x') {
    const milliseconds = BigInt(post.id) >> 22n
    return milliseconds === 0n
      ? null
      : plausible(Number((milliseconds + X_EPOCH_MS) / 1000n))
  }
  if (!/^[234567a-j][234567a-z]{12}$/.test(post.rkey)) return null
  let value = 0n
  for (const character of post.rkey)
    value = (value << 5n) | BigInt(SORTABLE.indexOf(character))
  return plausible(Number((value >> 10n) / 1000000n))
}
