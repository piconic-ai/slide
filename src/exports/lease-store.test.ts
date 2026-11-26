import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { LEASE_SECONDS } from './lease'
import { acquireZipLease } from './lease-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const bucket = platform.env.UPLOADS
afterAll(() => platform.dispose())
beforeEach(async () => {
  await bucket.delete('exports/leases/u1')
  await bucket.delete('exports/leases/u2')
})

const acquired = (lease: Awaited<ReturnType<typeof acquireZipLease>>) =>
  lease.kind === 'acquired'

describe('acquireZipLease', () => {
  it('F35-AC29: Given nobody holds the lease, When a person asks, Then they get it, and a second ask while it is held is told to wait', async () => {
    const first = await acquireZipLease(bucket, 'u1', 1000)
    const second = await acquireZipLease(bucket, 'u1', 1010)

    expect(first.kind).toBe('acquired')
    expect(second).toEqual({ kind: 'busy', retryAfter: LEASE_SECONDS - 10 })
  })

  it('F35-AC29: Given one person holds the lease, When another asks, Then the other gets theirs', async () => {
    await acquireZipLease(bucket, 'u1', 1000)

    expect((await acquireZipLease(bucket, 'u2', 1000)).kind).toBe('acquired')
  })

  it('F35-AC29: Given a held lease is released, When the person asks again, Then they get it', async () => {
    const first = await acquireZipLease(bucket, 'u1', 1000)
    if (first.kind !== 'acquired') throw new Error('expected a lease')
    await first.release()

    expect((await acquireZipLease(bucket, 'u1', 1001)).kind).toBe('acquired')
  })

  it('F35-AC29: Given a lease nobody released, When its time has passed, Then the person gets a new one', async () => {
    await acquireZipLease(bucket, 'u1', 1000)

    expect(
      (await acquireZipLease(bucket, 'u1', 1000 + LEASE_SECONDS)).kind,
    ).toBe('acquired')
  })

  it('F35-AC29: Given a lease that was taken over after it lapsed, When the old holder releases it, Then the new holder keeps it', async () => {
    const old = await acquireZipLease(bucket, 'u1', 1000)
    if (old.kind !== 'acquired') throw new Error('expected a lease')
    const taken = await acquireZipLease(bucket, 'u1', 1000 + LEASE_SECONDS)
    expect(taken.kind).toBe('acquired')

    await old.release()

    expect(
      (await acquireZipLease(bucket, 'u1', 1000 + LEASE_SECONDS + 1)).kind,
    ).toBe('busy')
  })

  it('F35-AC29: Given twenty asks at once, When they race, Then exactly one gets the lease', async () => {
    const leases = await Promise.all(
      Array.from({ length: 20 }, () => acquireZipLease(bucket, 'u1', 1000)),
    )

    expect(leases.filter(acquired)).toHaveLength(1)
  })

  it('F35-AC29: Given a lapsed lease, When twenty asks race to take it over, Then exactly one gets it', async () => {
    await acquireZipLease(bucket, 'u1', 1000)
    const leases = await Promise.all(
      Array.from({ length: 20 }, () =>
        acquireZipLease(bucket, 'u1', 1000 + LEASE_SECONDS),
      ),
    )

    expect(leases.filter(acquired)).toHaveLength(1)
  })

  it('Given a lease object with damaged metadata, When the person asks, Then they are not locked out', async () => {
    await bucket.put('exports/leases/u1', '', {
      customMetadata: { until: 'x' },
    })

    expect((await acquireZipLease(bucket, 'u1', 1000)).kind).toBe('acquired')
  })

  it('Given a user ID that is not plain, When asked, Then no lease is made and nothing is written', async () => {
    expect(await acquireZipLease(bucket, '../avatars/1', 1000)).toEqual({
      kind: 'invalid_user',
    })
    expect((await bucket.list({ prefix: 'exports/' })).objects).toHaveLength(0)
  })
})
