import { expect, test } from 'vitest'
import { FRAME_SESSION_SECONDS, frameSessionTimes } from './lifetime'

test('F02-AC33: Given a session opened in the viewer’s frame, When its times are made, Then it lasts five minutes and has no later hard limit to renew toward', () => {
  expect(FRAME_SESSION_SECONDS).toBe(300)
  expect(frameSessionTimes(1000)).toEqual({
    createdAt: 1000,
    expiresAt: 1300,
    hardExpiresAt: 1300,
  })
})
