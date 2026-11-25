import { describe, expect, it } from 'vitest'
import {
  injectedValidator,
  injectIntoBytes,
  injectPageScript,
  MAX_INJECTED_BYTES,
} from './inject'
import { pageScript, scriptHashSource } from './script'

const SCRIPT = 'tell()'
const TAG = `<script>${SCRIPT}</script>`
const inject = (html: string) => injectPageScript(html, SCRIPT)

const policy = (content: string) =>
  `<meta http-equiv="Content-Security-Policy" content="${content}">`

/** Where each match of `pattern` starts in `text`. */
const startsOf = (text: string, pattern: RegExp) =>
  [...text.matchAll(pattern)].map((match) => match.index)

describe('injectPageScript', () => {
  it.each([
    [
      'a head',
      '<!doctype html><html><head><title>t</title></head><body></body></html>',
      `<!doctype html><html><head>${TAG}<title>t</title></head><body></body></html>`,
    ],
    [
      'a head with attributes in capitals',
      `<!DOCTYPE html><HTML lang="ja"><HEAD data-x='>'><TITLE>t</TITLE>`,
      `<!DOCTYPE html><HTML lang="ja"><HEAD data-x='>'>${TAG}<TITLE>t</TITLE>`,
    ],
    [
      'no head tag, after html',
      '<!doctype html><html lang="en"><title>t</title><p>x',
      `<!doctype html><html lang="en">${TAG}<title>t</title><p>x`,
    ],
    [
      'no head or html tag, after the doctype',
      '<!doctype html><title>t</title><p>x',
      `<!doctype html>${TAG}<title>t</title><p>x`,
    ],
    [
      'comments and a byte order mark before the doctype',
      '﻿<!-- a -->\n<!doctype html><p>x',
      `﻿<!-- a -->\n<!doctype html>${TAG}<p>x`,
    ],
    [
      'a head spelled inside a comment, a script and a template first',
      `<!doctype html><!-- <head> --><script>'<head>'</script><template><head></template><html><head><p>`,
      `<!doctype html><!-- <head> -->${TAG}<script>'<head>'</script><template><head></template><html><head><p>`,
    ],
    [
      'a head without a doctype',
      '<head><title>t</title></head><p>x</p>',
      `<head>${TAG}<title>t</title></head><p>x</p>`,
    ],
    [
      'the author’s own script first',
      '<!doctype html><head><script src="deck.js"></script></head>',
      `<!doctype html><head>${TAG}<script src="deck.js"></script></head>`,
    ],
    [
      'a script before the head tag',
      '<!doctype html><script>a()</script><html><head></head>',
      `<!doctype html>${TAG}<script>a()</script><html><head></head>`,
    ],
    [
      'the page script already loaded from its file',
      '<!doctype html><head><script src="/_preview/pages.js"></script></head>',
      `<!doctype html><head>${TAG}<script src="/_preview/pages.js"></script></head>`,
    ],
  ])(
    'F03-AC143: Given a document with %s, When it is served, Then the page script goes near the start of its head and nothing else changes',
    (_, html, expected) => {
      expect(inject(html)).toBe(expected)
    },
  )

  it.each([
    [
      'no meta policy and the author’s script',
      `<head><meta charset="utf-8"><title>t</title><script src=a.js></script>`,
    ],
    [
      'a charset and then a policy',
      `<head><meta charset="utf-8">${policy("script-src 'self'")}<title>t</title>`,
    ],
    [
      'two policies and the author’s scripts after them',
      `<head>${policy("script-src 'self'")}${policy("default-src 'none'; script-src 'unsafe-inline'")}<script src=a.js></script><script>b()</script>`,
    ],
    [
      'a policy after the author’s first script',
      `<head><script>a()</script>${policy("script-src 'self'")}`,
    ],
    [
      'a policy before the head tag',
      `${policy("script-src 'self'")}<html><head><title>t</title>`,
    ],
    [
      'a policy between the html and head tags',
      `<html>${policy("script-src 'self'")}<head><script>a()</script>`,
    ],
    [
      'a policy and no head or html tag',
      `${policy("script-src 'none'")}<title>t</title><script>a()</script>`,
    ],
    [
      'the author’s script first in the head, then a policy',
      `<html><head><script src=deck.js></script><meta charset=utf-8>${policy("script-src 'self'")}`,
    ],
  ])(
    'F03-AC151: Given a document with %s, When it is served, Then the page script comes before every meta policy and the author’s first script',
    (_, head) => {
      const html = `<!doctype html>${head}</head><body><p>slides</p></body></html>`
      const served = inject(html)!
      const at = served.indexOf(TAG)
      expect(at).toBeGreaterThan(-1)
      const others = startsOf(served, /<meta http-equiv|<script/gi).filter(
        (start) => start !== at,
      )
      expect(others.length).toBeGreaterThan(0)
      for (const start of others) expect(at).toBeLessThan(start)
    },
  )

  it('F03-AC151: Given a policy before the head tag, When it is served, Then the page script goes right before that policy', () => {
    const meta = policy("script-src 'self'")
    expect(inject(`<!doctype html>${meta}<html><head><title>t`)).toBe(
      `<!doctype html>${TAG}${meta}<html><head><title>t`,
    )
    expect(inject(`<html>${meta}<head><title>t`)).toBe(
      `<html>${TAG}${meta}<head><title>t`,
    )
  })

  it.each([
    [
      'sanpo’s policy, with unsafe-inline',
      policy(
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
      ),
    ],
    ['self only', policy("script-src 'self'")],
    ['a hash only', policy("script-src 'sha256-AAAA'")],
    ['default-src none only', policy("default-src 'none'")],
    [
      'a nonce and strict-dynamic',
      policy("script-src 'nonce-abc' 'strict-dynamic'"),
    ],
    [
      'single quotes around the value',
      `<meta http-equiv="Content-Security-Policy" content='script-src "self"'>`,
    ],
    [
      'no quotes around the value',
      `<meta http-equiv=Content-Security-Policy content=script-src>`,
    ],
    [
      'the content attribute before http-equiv, in capitals',
      `<meta CONTENT="script-src 'self'" HTTP-EQUIV=" Content-Security-Policy ">`,
    ],
    [
      'a character reference in the value',
      `<meta http-equiv="Content-Security-Policy" content="script-src &#39;self&#39;">`,
    ],
    [
      'a character reference that seems to allow inline',
      `<meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline' &#39;nonce-a&#39;">`,
    ],
    [
      'a policy after the author’s first script',
      `<script>a()</script>${policy("script-src 'self'")}`,
    ],
    ['a policy inside a comment', `<!-- ${policy("script-src 'self'")} -->`],
    [
      'a policy inside a template',
      `<template>${policy("script-src 'self'")}</template>`,
    ],
    [
      'a policy in a script’s text',
      `<script>"<meta http-equiv='Content-Security-Policy' content='script-src none'>"</script>`,
    ],
    [
      'a policy with another http-equiv',
      `<meta http-equiv="Content-Security-Policy-Report-Only" content="script-src 'self'">`,
    ],
    ['a policy without content', `<meta http-equiv="Content-Security-Policy">`],
  ])(
    'F03-AC152: Given %s, When the document is served, Then everything but the page script is as stored',
    (_, markup) => {
      const html = `<!doctype html><html><head><meta charset="utf-8">${markup}<title>t</title></head><body><p>slides</p></body></html>`
      const served = inject(html)
      expect(served).not.toBeNull()
      expect(served!.split(TAG)).toHaveLength(2)
      expect(served!.replace(TAG, '')).toBe(html)
    },
  )

  it.each([
    ['a piece of HTML', '<h1>Cited</h1><p>text</p>'],
    ['an empty file', ''],
    ['text only', 'slides'],
    ['an unclosed comment before anything', '<!-- <!doctype html><head>'],
  ])(
    'F03-AC153: Given %s, When it is served, Then it is left as stored',
    (_, html) => {
      expect(inject(html)).toBeNull()
    },
  )
})

describe('injectIntoBytes', () => {
  const bytes = (text: string) => new TextEncoder().encode(text)

  it('F03-AC143: Given UTF-8 with a byte order mark, When it is served, Then the mark stays first and the script follows the head tag', () => {
    const served = injectIntoBytes(
      bytes('﻿<!doctype html><head><title>発表</title>'),
      SCRIPT,
    )
    expect([...served!.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(served!)).toBe(
      `<!doctype html><head>${TAG}<title>発表</title>`,
    )
  })

  it.each([
    [
      'Shift_JIS bytes',
      new Uint8Array([0x3c, 0x68, 0x65, 0x61, 0x64, 0x3e, 0x82, 0xa0]),
    ],
    ['UTF-16', new Uint8Array([0x3c, 0x00, 0x68, 0x00])],
    [
      'ISO-2022-JP, whose characters use ASCII bytes',
      new Uint8Array([...bytes('<head>'), 0x1b, 0x24, 0x42, 0x3c, 0x2f]),
    ],
    [
      'ISO-2022-JP that shifts with ESC ( J',
      new Uint8Array([...bytes('<head>'), 0x1b, 0x28, 0x4a, 0x41]),
    ],
    [
      'a NUL between the tags',
      new Uint8Array([...bytes('<!doctype html><head>'), 0x00]),
    ],
    [
      'a document over the limit',
      bytes(`<!doctype html><head></head>${'x'.repeat(MAX_INJECTED_BYTES)}`),
    ],
  ])(
    'F03-AC153: Given %s, When it is served, Then it is left as stored',
    (_, stored) => {
      expect(injectIntoBytes(stored, SCRIPT)).toBeNull()
    },
  )

  it('F03-AC143: Given UTF-8 that holds an ANSI colour escape, When it is served, Then the script still goes in', () => {
    const html =
      '<!doctype html><head><title>t</title></head><pre>\u001b[31mred\u001b[0m</pre>'
    const served = injectIntoBytes(bytes(html), SCRIPT)
    expect(new TextDecoder().decode(served!)).toBe(
      html.replace('<title>', `${TAG}<title>`),
    )
  })

  it('F03-AC153: Given a document of exactly the limit, When it is served, Then the script still goes in', () => {
    const start = '<!doctype html><head></head>'
    const stored = bytes(start + 'x'.repeat(MAX_INJECTED_BYTES - start.length))
    expect(injectIntoBytes(stored, SCRIPT)?.length).toBe(
      MAX_INJECTED_BYTES + TAG.length,
    )
  })

  it('F03-AC152: Given Japanese text and a policy with a character reference, When it is served, Then the stored bytes are kept around the script', () => {
    const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src &#39;self&#39;"><title>発表 🍣</title></head><body>本文</body></html>`
    const served = injectIntoBytes(bytes(html), SCRIPT)
    expect(new TextDecoder().decode(served!).replace(TAG, '')).toBe(html)
  })
})

describe('meta policies at scale', () => {
  const meta = policy("script-src 'none'")
  const withMetas = (count: number) =>
    `<!doctype html><html><head>${meta.repeat(count)}<title>t</title></head>`

  it.each([16, 17, 100])(
    'F03-AC153: Given %i meta policies, When the document is served, Then the page script goes in before them and they stay as stored',
    (count) => {
      const html = withMetas(count)
      expect(inject(html)).toBe(html.replace('<head>', `<head>${TAG}`))
    },
  )
})

describe('injectedValidator', () => {
  it('F03-AC148: Given the same file, When the script changes, Then the validator changes, and the same pair gives the same one', async () => {
    const sha = 'a'.repeat(64)
    const one = await scriptHashSource(pageScript('https://slide.example'))
    const two = await scriptHashSource(pageScript('https://other.example'))
    expect(injectedValidator(sha, one)).toBe(injectedValidator(sha, one))
    expect(injectedValidator(sha, one)).not.toBe(injectedValidator(sha, two))
    expect(injectedValidator(sha, one)).not.toBe(
      injectedValidator('b'.repeat(64), one),
    )
    expect(injectedValidator(sha, one)).toMatch(/^a{64}-p2-[A-Za-z0-9+/]{16}$/)
  })
})

describe('scriptHashSource', () => {
  it('F03-AC148: Given a script, When its hash source is made, Then it is the base64 SHA-256 of its text', async () => {
    // printf 'alert(1)' | openssl dgst -sha256 -binary | base64
    expect(await scriptHashSource('alert(1)')).toBe(
      "'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='",
    )
  })
})
