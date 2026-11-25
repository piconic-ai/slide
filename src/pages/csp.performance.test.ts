import { describe, expect, it } from 'vitest'
import { withInlineScript } from './csp'

const HASH = "'sha256-oNW1cNpPOxwIUlyKWOfRJBcc5/5kt4KQy1pyNNIGr4M='"

describe('policies at scale', () => {
  // A duplicate was looked for among every directive seen so far: 80,000
  // directives took 24 seconds.
  it.each([
    ['many directives', 80000, (index: number) => `d${index}`],
    ['many white space runs', 200000, () => ' \t '],
  ])(
    'F03-AC144: Given a policy of %s before script-src, When the page script is let through, Then the answer comes in time linear in its size',
    (_, count, part) => {
      const policy = `${Array.from({ length: count }, (_, index) => part(index)).join(';')}; script-src 'none'`
      const started = performance.now()

      const adjusted = withInlineScript(policy, HASH)

      expect(adjusted.endsWith(`script-src ${HASH}`)).toBe(true)
      expect(performance.now() - started).toBeLessThan(2000)
    },
    30000,
  )
})
