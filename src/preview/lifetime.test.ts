import { expect, test } from 'vitest'
import {
  newSessionTimes,
  renewedExpiry,
  SESSION_HARD_SECONDS,
  SESSION_IDLE_SECONDS,
} from './lifetime'

const session = newSessionTimes(1000)

test('Given a new session, When created, Then it idles out before the hard limit', () => {
  expect(session).toEqual({
    createdAt: 1000,
    expiresAt: 1000 + SESSION_IDLE_SECONDS,
    hardExpiresAt: 1000 + SESSION_HARD_SECONDS,
  })
})

test('Given a fresh session, When used, Then nothing is written', () => {
  expect(renewedExpiry(session, 1010)).toBeNull()
})

test('Given less than half the idle window left, When used, Then it extends a full window', () => {
  const now = session.expiresAt - SESSION_IDLE_SECONDS / 2
  expect(renewedExpiry(session, now)).toBe(now + SESSION_IDLE_SECONDS)
})

test('Given the hard limit is near, When renewed, Then it stops at the hard limit', () => {
  const late = {
    expiresAt: session.hardExpiresAt - 60,
    hardExpiresAt: session.hardExpiresAt,
  }
  expect(renewedExpiry(late, late.expiresAt - 30)).toBe(session.hardExpiresAt)
  expect(
    renewedExpiry(
      {
        expiresAt: session.hardExpiresAt,
        hardExpiresAt: session.hardExpiresAt,
      },
      session.hardExpiresAt - 10,
    ),
  ).toBeNull()
})

test('Given an expired session, When used, Then it is not renewed', () => {
  expect(renewedExpiry(session, session.expiresAt)).toBeNull()
  expect(renewedExpiry(session, session.expiresAt + 1)).toBeNull()
})
