import { describe, expect, it } from 'vitest'
import { allowsAllInline, withInlineScript } from './csp'

const HASH = "'sha256-oNW1cNpPOxwIUlyKWOfRJBcc5/5kt4KQy1pyNNIGr4M='"
const OTHER = "'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='"

describe('withInlineScript', () => {
  it.each([
    ['no directive about scripts', "style-src 'self'; img-src data:"],
    ['an empty policy', ''],
    ['white space and separators only', ' ; ;  '],
    ['the sanpo policy', "default-src 'none'; script-src 'unsafe-inline'"],
    ['unsafe-inline in default-src only', "default-src 'unsafe-inline'"],
    ['unsafe-inline in capitals', "SCRIPT-SRC 'UNSAFE-INLINE'"],
    [
      'unsafe-inline next to a broken hash, which browsers ignore',
      "script-src 'unsafe-inline' 'sha256-'",
    ],
    [
      'unsafe-inline in script-src-elem, which governs elements',
      "script-src 'self'; script-src-elem 'unsafe-inline'",
    ],
    ['the hash already there', `script-src 'self' ${HASH}`],
    [
      'a later duplicate that browsers ignore',
      "script-src 'unsafe-inline'; script-src 'self'",
    ],
    ['a directive with an invalid name only', "script_src 'self'"],
  ])(
    'F03-AC144: Given a policy with %s, When the page script is let through, Then the policy is left as it is',
    (_, policy) => {
      expect(withInlineScript(policy, HASH)).toBe(policy)
    },
  )

  it.each([
    ['self only', "script-src 'self'", `script-src 'self' ${HASH}`],
    ['none', "script-src 'none'", `script-src ${HASH}`],
    ['none in capitals', "script-src 'NONE'", `script-src ${HASH}`],
    [
      'none next to another source',
      "script-src 'none' https://cdn.example",
      `script-src https://cdn.example ${HASH}`,
    ],
    ['no value', 'script-src', `script-src ${HASH}`],
    ['a hash of its own', `script-src ${OTHER}`, `script-src ${OTHER} ${HASH}`],
    [
      'unsafe-inline that a hash already turns off',
      `script-src 'unsafe-inline' ${OTHER}`,
      `script-src 'unsafe-inline' ${OTHER} ${HASH}`,
    ],
    [
      'unsafe-inline that a nonce turns off',
      "script-src 'nonce-abc123' 'unsafe-inline'",
      `script-src 'nonce-abc123' 'unsafe-inline' ${HASH}`,
    ],
    [
      'strict-dynamic, kept as it is',
      "script-src 'strict-dynamic' 'unsafe-inline' https:",
      `script-src 'strict-dynamic' 'unsafe-inline' https: ${HASH}`,
    ],
    [
      'a name in capitals, kept as written',
      "Script-Src 'self'",
      `Script-Src 'self' ${HASH}`,
    ],
    [
      'script-src-elem, which governs elements over script-src',
      "script-src 'unsafe-inline'; script-src-elem 'self'",
      `script-src 'unsafe-inline'; script-src-elem 'self' ${HASH}`,
    ],
    [
      'a duplicate, of which only the first counts',
      "script-src 'self'; script-src 'unsafe-inline'",
      `script-src 'self' ${HASH}; script-src 'unsafe-inline'`,
    ],
    [
      'spacing around the directive',
      "img-src data: ;  script-src\t'self'  ; style-src 'self'",
      `img-src data: ;  script-src 'self' ${HASH}  ; style-src 'self'`,
    ],
    [
      'default-src none and no script-src',
      "default-src 'none'; style-src 'unsafe-inline'",
      `default-src 'none'; style-src 'unsafe-inline'; script-src ${HASH}`,
    ],
    [
      'default-src with sources and no script-src',
      "default-src 'self' https://cdn.example",
      `default-src 'self' https://cdn.example; script-src 'self' https://cdn.example ${HASH}`,
    ],
    [
      'default-src that ends with a separator',
      "default-src 'self';",
      `default-src 'self'; script-src 'self' ${HASH}`,
    ],
    [
      'default-src with a nonce',
      "default-src 'nonce-abc' 'unsafe-inline'",
      `default-src 'nonce-abc' 'unsafe-inline'; script-src 'nonce-abc' 'unsafe-inline' ${HASH}`,
    ],
  ])(
    'F03-AC144: Given a policy with %s, When the page script is let through, Then its hash alone is added where it governs scripts',
    (_, policy, expected) => {
      expect(withInlineScript(policy, HASH)).toBe(expected)
    },
  )

  it('F03-AC144: Given an adjusted policy, When it is adjusted again, Then nothing more is added', () => {
    const once = withInlineScript("default-src 'none'", HASH)
    expect(withInlineScript(once, HASH)).toBe(once)
  })

  it.each([
    "script-src 'self'; object-src 'none'; base-uri 'none'",
    "default-src 'none'; connect-src 'none'; frame-src about:",
  ])(
    'F03-AC144: Given %s, When the page script is let through, Then every other directive keeps its sources',
    (policy) => {
      const adjusted = withInlineScript(policy, HASH)
      const others = (text: string) =>
        text
          .split(';')
          .map((part) => part.trim())
          .filter((part) => part && !part.startsWith('script-src'))
      expect(others(adjusted)).toEqual(others(policy))
    },
  )
})

describe('white space', () => {
  it.each([
    [
      'a no-break space after the source, which keeps it from being one',
      "default-src 'self'\u00a0",
      `default-src 'self'\u00a0; script-src 'self'\u00a0 ${HASH}`,
    ],
    [
      'an ideographic space inside the directive',
      "script-src\u3000'unsafe-inline'; default-src 'none'",
      `script-src\u3000'unsafe-inline'; default-src 'none'; script-src ${HASH}`,
    ],
    [
      'tabs, line feeds and form feeds around the directive',
      "\t\fscript-src\n'self'\r ",
      `\t\fscript-src 'self' ${HASH}\r `,
    ],
  ])(
    'F03-AC144: Given a policy with %s, When the page script is let through, Then only ASCII white space separates, as a browser reads it',
    (_, policy, expected) => {
      expect(withInlineScript(policy, HASH)).toBe(expected)
    },
  )
})

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

describe('allowsAllInline', () => {
  it.each([
    [["'unsafe-inline'"], true],
    [["'unsafe-inline'", "'self'"], true],
    [["'unsafe-inline'", "'nonce-x'"], false],
    [["'unsafe-inline'", "'sha384-abc='"], false],
    [["'unsafe-inline'", "'SHA512-abc'"], false],
    [["'unsafe-inline'", "'strict-dynamic'"], false],
    [["'unsafe-inline'", "'nonce-'"], true],
    [["'self'"], false],
    [[], false],
  ])(
    'F03-AC144: Given the sources %j, When asked, Then whether every inline script runs is %s',
    (sources, allowed) => {
      expect(allowsAllInline(sources)).toBe(allowed)
    },
  )
})
