import { describe, expect, it } from 'vitest'
import {
  injectedValidator,
  injectIntoBytes,
  injectPageScript,
  MAX_INJECTED_BYTES,
} from './inject'
import { pageScript, scriptHashSource } from './script'

const SCRIPT = 'tell()'
const HASH = "'sha256-oNW1cNpPOxwIUlyKWOfRJBcc5/5kt4KQy1pyNNIGr4M='"
const TAG = `<script>${SCRIPT}</script>`
const inject = (html: string) => injectPageScript(html, SCRIPT, HASH)

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
      'a charset and then a policy without scripts',
      `<!doctype html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="img-src data:"><title>t</title>`,
      `<!doctype html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="img-src data:">${TAG}<title>t</title>`,
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
      'sanpo’s policy, with unsafe-inline',
      `content="default-src 'none'; script-src 'unsafe-inline'"`,
      `content="default-src 'none'; script-src 'unsafe-inline'"`,
    ],
    [
      'self only',
      `content="script-src 'self'"`,
      `content="script-src 'self' ${HASH}"`,
    ],
    [
      'a hash only',
      `content="script-src 'sha256-AAAA'"`,
      `content="script-src 'sha256-AAAA' ${HASH}"`,
    ],
    [
      'default-src none only',
      `content="default-src 'none'"`,
      `content="default-src 'none'; script-src ${HASH}"`,
    ],
    [
      'single quotes around the value',
      `content='script-src "self"'`,
      `content="script-src &quot;self&quot; ${HASH}"`,
    ],
    [
      'no quotes around the value',
      `content=script-src`,
      `content="script-src ${HASH}"`,
    ],
    [
      'the content attribute before http-equiv, in capitals',
      `CONTENT="script-src 'self'"`,
      `CONTENT="script-src 'self' ${HASH}"`,
    ],
  ])(
    'F03-AC144: Given a meta policy with %s, When the document is served, Then only what the page script needs is added',
    (_, written, expected) => {
      const html = (content: string) =>
        `<!doctype html><head><meta http-equiv="content-security-policy" ${content}><title>t</title>`
      const meta = (content: string) =>
        written.startsWith('CONTENT')
          ? `<!doctype html><head><meta ${content} HTTP-EQUIV=" Content-Security-Policy "><title>t</title>`
          : html(content)
      expect(inject(meta(written))).toBe(
        meta(expected).replace('<title>', `${TAG}<title>`),
      )
    },
  )

  it('F03-AC144: Given two meta policies, When the document is served, Then each lets the page script run, and the script follows both', () => {
    const html = `<!doctype html><head><meta http-equiv="Content-Security-Policy" content="script-src 'self'"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'"><title>t</title><script src=a.js></script></head>`
    expect(inject(html)).toBe(
      `<!doctype html><head><meta http-equiv="Content-Security-Policy" content="script-src 'self' ${HASH}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'">${TAG}<title>t</title><script src=a.js></script></head>`,
    )
  })

  it('F03-AC144: Given a policy after the author’s first script, When the document is served, Then the page script still runs first and the later policy lets it through', () => {
    const html = `<!doctype html><head><script>a()</script><meta http-equiv="Content-Security-Policy" content="script-src 'self'"></head>`
    expect(inject(html)).toBe(
      `<!doctype html><head>${TAG}<script>a()</script><meta http-equiv="Content-Security-Policy" content="script-src 'self' ${HASH}"></head>`,
    )
  })

  it.each([
    [
      'inside a comment',
      `<!-- <meta http-equiv="Content-Security-Policy" content="script-src 'self'"> -->`,
    ],
    [
      'inside a template',
      `<template><meta http-equiv="Content-Security-Policy" content="script-src 'self'"></template>`,
    ],
    [
      'in a script’s text',
      `<script>"<meta http-equiv='Content-Security-Policy' content='script-src none'>"</script>`,
    ],
    [
      'in the body, where browsers ignore it',
      `<body><meta http-equiv="Content-Security-Policy" content="script-src 'self'">`,
    ],
    [
      'with another http-equiv',
      `<meta http-equiv="Content-Security-Policy-Report-Only" content="script-src 'self'">`,
    ],
    ['without content', `<meta http-equiv="Content-Security-Policy">`],
  ])(
    'F03-AC144: Given a meta policy %s, When the document is served, Then it is not changed',
    (_, markup) => {
      const html = `<!doctype html><head></head>${markup}`
      const served = inject(html)
      expect(served).not.toBeNull()
      expect(served!.replace(TAG, '')).toBe(html)
    },
  )

  it.each([
    ['a piece of HTML', '<h1>Cited</h1><p>text</p>'],
    ['an empty file', ''],
    ['text only', 'slides'],
    ['an unclosed comment before anything', '<!-- <!doctype html><head>'],
    [
      'a policy with a character reference',
      `<!doctype html><head><meta http-equiv="Content-Security-Policy" content="script-src &#39;self&#39;">`,
    ],
    [
      'a policy with a character reference that seems to allow inline',
      `<!doctype html><head><meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline' &#39;nonce-a&#39;">`,
    ],
  ])(
    'F03-AC147: Given %s, When it is served, Then it is left as stored',
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
      HASH,
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
      'a document over the limit',
      bytes(`<!doctype html><head></head>${'x'.repeat(MAX_INJECTED_BYTES)}`),
    ],
  ])(
    'F03-AC147: Given %s, When it is served, Then it is left as stored',
    (_, stored) => {
      expect(injectIntoBytes(stored, SCRIPT, HASH)).toBeNull()
    },
  )

  it('F03-AC147: Given a document of exactly the limit, When it is served, Then the script still goes in', () => {
    const start = '<!doctype html><head></head>'
    const stored = bytes(start + 'x'.repeat(MAX_INJECTED_BYTES - start.length))
    expect(injectIntoBytes(stored, SCRIPT, HASH)?.length).toBe(
      MAX_INJECTED_BYTES + TAG.length,
    )
  })

  // A served index.html is read with this scan on every full answer.
  it.each([
    ['tags that never close', '<a '],
    ['tags that open a quote and never close', '<a "'],
    ['comments that never close', '<!--'],
    ['scripts that never close', '<script>'],
    ['templates that never close', '<template>'],
    [
      'meta tags with unclosed values',
      `<meta http-equiv=content-security-policy content="`,
    ],
    ['bare less-than signs', '<'],
  ])(
    'F03-AC147: Given the largest file full of %s, When it is served, Then the answer comes in time linear in its size',
    (_, unit) => {
      const start = '<!doctype html><html><head>'
      const html =
        start + unit.repeat((MAX_INJECTED_BYTES - start.length) / unit.length)
      const started = performance.now()
      injectIntoBytes(bytes(html.slice(0, MAX_INJECTED_BYTES)), SCRIPT, HASH)
      expect(performance.now() - started).toBeLessThan(10000)
    },
    30000,
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
    expect(injectedValidator(sha, one)).toMatch(/^a{64}-p1-[A-Za-z0-9+/]{16}$/)
  })
})

describe('scriptHashSource', () => {
  it('F03-AC144: Given a script, When its hash source is made, Then it is the base64 SHA-256 a browser computes', async () => {
    // printf 'alert(1)' | openssl dgst -sha256 -binary | base64
    expect(await scriptHashSource('alert(1)')).toBe(
      "'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='",
    )
  })
})
