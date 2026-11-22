import { expect, test } from 'vitest'
import {
  STALE_SIGNUP_SECONDS,
  SWEEP_LIMIT,
  staleSignups,
  type SignupUser,
} from './signup-sweep'

const NOW = 1_000_000
const user = (patch: Partial<SignupUser> & { id: string }): SignupUser => ({
  lastSignInAt: NOW - STALE_SIGNUP_SECONDS,
  hasAccount: false,
  suspended: false,
  ...patch,
})

test('F28-AC71: Given users whose last sign-in was exactly 24 hours ago, just under and just over, When the stale ones are chosen, Then exactly 24 hours is swept and just under is not', () => {
  expect(
    staleSignups(
      [
        user({ id: 'exact' }),
        user({ id: 'under', lastSignInAt: NOW - STALE_SIGNUP_SECONDS + 1 }),
        user({ id: 'over', lastSignInAt: NOW - STALE_SIGNUP_SECONDS - 1 }),
        user({ id: 'new', lastSignInAt: NOW }),
      ],
      NOW,
    ),
  ).toEqual(['over', 'exact'])
})

test('F28-AC69: Given old users with an account or a suspension, When the stale ones are chosen, Then neither is swept', () => {
  expect(
    staleSignups(
      [
        user({ id: 'has-account', hasAccount: true }),
        user({ id: 'suspended', suspended: true }),
        user({ id: 'plain' }),
      ],
      NOW,
    ),
  ).toEqual(['plain'])
})

test('F28-AC71: Given nobody, or a time before everyone was made, When the stale ones are chosen, Then none is', () => {
  expect(staleSignups([], NOW)).toEqual([])
  expect(
    staleSignups([user({ id: 'a', lastSignInAt: NOW + 10 })], NOW),
  ).toEqual([])
})

test('F28-AC74: Given more stale users than the limit, When they are chosen, Then only the limit are, the longest idle first, and the rest are chosen by the next run', () => {
  const users = Array.from({ length: SWEEP_LIMIT + 5 }, (_, i) =>
    user({ id: `u${i}`, lastSignInAt: NOW - STALE_SIGNUP_SECONDS - i }),
  )
  const first = staleSignups(users, NOW)
  expect(first).toHaveLength(SWEEP_LIMIT)
  expect(first[0]).toBe(`u${SWEEP_LIMIT + 4}`)
  const rest = users.filter((u) => !first.includes(u.id))
  expect(staleSignups(rest, NOW)).toHaveLength(5)
  expect(staleSignups(users, NOW, 3)).toHaveLength(3)
})
