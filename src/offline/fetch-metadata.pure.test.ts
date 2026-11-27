import { describe, expect, test } from 'vitest'
import { mayAnswerEviction } from './fetch-metadata'

describe('mayAnswerEviction', () => {
  const own = ['same-origin', 'same-site']
  test.each([
    // [dest, site, sites, answered]
    ['iframe', 'same-origin', own, true],
    ['iframe', 'same-site', own, true],
    ['iframe', 'cross-site', own, false],
    ['iframe', 'none', own, false],
    ['document', 'none', own, false],
    ['document', 'same-origin', own, false],
    ['empty', 'same-origin', own, false],
    ['script', 'same-origin', own, false],
    // No metadata: a browser that sends none is answered as before.
    [undefined, undefined, own, true],
    ['iframe', undefined, own, true],
    [undefined, 'cross-site', own, false],
    // Any site may frame the version's own page, but only a frame.
    ['iframe', 'cross-site', null, true],
    ['iframe', 'same-site', null, true],
    ['document', 'none', null, false],
    ['document', 'cross-site', null, false],
  ] as const)(
    'F37-AC7: Given Sec-Fetch-Dest %s and Sec-Fetch-Site %s, Then it answers: %s',
    (dest, site, sites, answered) => {
      expect(mayAnswerEviction({ dest, site }, sites)).toBe(answered)
    },
  )
})
