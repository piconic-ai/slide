import { describe, expect, it } from 'vitest'
import { holdingOf, leaseKey, LEASE_SECONDS } from './lease'

describe('holdingOf', () => {
  it('Given a lease that holds for 100 more seconds, When read, Then it is held with that wait', () => {
    expect(holdingOf('1100', 1000)).toEqual({ kind: 'held', retryAfter: 100 })
  })

  it('Given a lease that ends exactly now, When read, Then it has lapsed', () => {
    expect(holdingOf('1000', 1000)).toEqual({ kind: 'lapsed' })
  })

  it.each([undefined, null, '', 'soon', 'NaN', 'Infinity', {}, 12])(
    'Given the unreadable value %j, When read, Then it counts as lapsed so nobody is locked out',
    (value) => {
      expect(holdingOf(value, 1000)).toEqual({ kind: 'lapsed' })
    },
  )

  it('Given a lease said to end far in the future, When read, Then the wait never exceeds the lease time', () => {
    expect(holdingOf(String(1000 + 1e9), 1000)).toEqual({
      kind: 'held',
      retryAfter: LEASE_SECONDS,
    })
  })
})

describe('leaseKey', () => {
  it.each(['722500', 'a-b_C9', 'x'.repeat(128)])(
    'Given the user ID %s, When keyed, Then the key is under the lease folder',
    (id) => {
      expect(leaseKey(id)).toBe(`exports/leases/${id}`)
    },
  )

  it.each(['', '../avatars/1', 'a/b', 'a b', 'x'.repeat(129), 'あ'])(
    'Given the odd user ID %j, When keyed, Then there is no key, so no object outside the folder can be named',
    (id) => {
      expect(leaseKey(id)).toBeNull()
    },
  )
})
