import { expect, test } from 'vitest'
import {
  STALE_SIGNUP_SECONDS,
  staleSignups,
  type SignupUser,
} from './signup-sweep'

const NOW = 1_000_000
const user = (patch: Partial<SignupUser> & { id: string }): SignupUser => ({
  createdAt: NOW - STALE_SIGNUP_SECONDS,
  hasAccount: false,
  suspended: false,
  ...patch,
})

test('F28-AC68: Given users made exactly 24 hours ago, just under and just over, When the stale ones are chosen, Then exactly 24 hours is swept and just under is not', () => {
  expect(
    staleSignups(
      [
        user({ id: 'exact' }),
        user({ id: 'under', createdAt: NOW - STALE_SIGNUP_SECONDS + 1 }),
        user({ id: 'over', createdAt: NOW - STALE_SIGNUP_SECONDS - 1 }),
        user({ id: 'new', createdAt: NOW }),
      ],
      NOW,
    ),
  ).toEqual(['exact', 'over'])
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

test('F28-AC68: Given nobody, or a time before everyone was made, When the stale ones are chosen, Then none is', () => {
  expect(staleSignups([], NOW)).toEqual([])
  expect(staleSignups([user({ id: 'a', createdAt: NOW + 10 })], NOW)).toEqual(
    [],
  )
})
