import { expect, test } from 'vitest'
import { parseLoginCodeLimits } from '../auth/login-policy'
import { mailFloodNotice, signupSurgeNotice } from './signup-notices'
import { parseAlertThresholds } from './thresholds'

const limits = parseLoginCodeLimits({ total: 100 })
const defaults = parseAlertThresholds({})

test.each([
  [0, false],
  [79, false],
  [80, true],
  [81, true],
  [100, true],
])(
  'F42-AC8: Given %i codes asked for of a total of 100, When they are judged, Then the operator is told: %s',
  (asked, told) => {
    const notice = mailFloodNotice(asked, limits)
    expect(notice !== null).toBe(told)
    if (notice)
      expect(notice).toEqual({
        kind: 'mail_flood',
        urgency: 'immediate',
        count: asked,
        link: '/operations#signups',
      })
  },
)

test('F42-AC22: Given a total of 10 in the settings, When 7 and 8 are judged, Then only 8 is told', () => {
  const small = parseLoginCodeLimits({ total: 10 })
  expect(mailFloodNotice(7, small)).toBeNull()
  expect(mailFloodNotice(8, small)).not.toBeNull()
})

test.each([
  // [last hour, the 7 days before, told]
  [0, 0, false],
  [9, 0, false],
  [10, 0, true],
  [11, 0, true],
  // An average of 1 an hour: 168 in the week. 10 is not more than 10 times.
  [10, 168, false],
  [11, 168, true],
  // 5 times 168 = 840 → an average of 5 an hour: more than 50 is a surge.
  [50, 840, false],
  [51, 840, true],
  // The minimum holds even where 10 times the average is lower.
  [9, 1, false],
  [10, 1, true],
  // A busy week: 16800 → 100 an hour; 1000 is not more than 10 times, 1001 is.
  [1000, 16_800, false],
  [1001, 16_800, true],
])(
  'F42-AC10: Given %i sign-ups in the last hour and %i in the 7 days before, When they are judged, Then the operator is told: %s',
  (lastHour, baseline, told) => {
    const notice = signupSurgeNotice({ lastHour, baseline }, defaults)
    expect(notice !== null).toBe(told)
    if (notice)
      expect(notice).toEqual({
        kind: 'signup_surge',
        urgency: 'immediate',
        count: lastHour,
        link: '/operations#signups',
      })
  },
)

test('F42-AC22: Given a factor of 2 and a minimum of 3, When sign-ups are judged against an average of 1 an hour, Then 3 is a surge, and 2 is neither the minimum nor more than twice the average', () => {
  const thresholds = parseAlertThresholds({
    signupSurgeFactor: 2,
    signupSurgeMinimum: 3,
  })
  expect(
    signupSurgeNotice({ lastHour: 2, baseline: 168 }, thresholds),
  ).toBeNull()
  expect(
    signupSurgeNotice({ lastHour: 3, baseline: 168 }, thresholds),
  ).not.toBeNull()
  // Past the factor but under the minimum, or the other way round: not told.
  expect(signupSurgeNotice({ lastHour: 2, baseline: 0 }, thresholds)).toBeNull()
  expect(
    signupSurgeNotice({ lastHour: 3, baseline: 504 }, thresholds),
  ).toBeNull()
})
