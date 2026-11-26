// The lease in R2. One object per person holds "until when"; it is made only
// if none exists (a conditional put R2 applies atomically across Workers),
// and taken over only from the exact object seen to have lapsed. This needs
// no table and no new binding.
import { holdingOf, leaseKey, LEASE_SECONDS } from './lease'

export type ZipLease =
  | Readonly<{ kind: 'acquired'; release: () => Promise<void> }>
  | Readonly<{ kind: 'busy'; retryAfter: number }>
  | Readonly<{ kind: 'invalid_user' }>

/**
 * R2 derives an object's etag from its bytes, so every lease needs bytes of
 * its own: two holders with the same body would have the same etag, and a
 * release or a takeover could not tell them apart.
 */
const holderBody = () => crypto.randomUUID()

const metadata = (now: number) => ({
  until: String(now + LEASE_SECONDS),
})

/**
 * Takes the person's lease, or says how long to wait. Only one holder exists
 * at a time. `release` gives it back if it is still this holder's.
 */
export async function acquireZipLease(
  bucket: R2Bucket,
  userId: string,
  now: number,
): Promise<ZipLease> {
  const key = leaseKey(userId)
  if (key === null) return { kind: 'invalid_user' }
  const made = await bucket.put(key, holderBody(), {
    customMetadata: metadata(now),
    onlyIf: new Headers({ 'If-None-Match': '*' }),
  })
  if (made) return acquired(bucket, key, made.etag)
  const current = await bucket.head(key)
  // Given back between the refused put and this read: try once more.
  if (!current) return retryOnce(bucket, key, now)
  const holding = holdingOf(current.customMetadata?.until, now)
  if (holding.kind === 'held')
    return { kind: 'busy', retryAfter: holding.retryAfter }
  const taken = await bucket.put(key, holderBody(), {
    customMetadata: metadata(now),
    onlyIf: { etagMatches: current.etag },
  })
  return taken
    ? acquired(bucket, key, taken.etag)
    : { kind: 'busy', retryAfter: 1 }
}

async function retryOnce(
  bucket: R2Bucket,
  key: string,
  now: number,
): Promise<ZipLease> {
  const made = await bucket.put(key, holderBody(), {
    customMetadata: metadata(now),
    onlyIf: new Headers({ 'If-None-Match': '*' }),
  })
  return made
    ? acquired(bucket, key, made.etag)
    : { kind: 'busy', retryAfter: 1 }
}

const acquired = (bucket: R2Bucket, key: string, etag: string): ZipLease => ({
  kind: 'acquired',
  release: async () => {
    const current = await bucket.head(key)
    if (current?.etag === etag) await bucket.delete(key)
  },
})
