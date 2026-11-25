// Reads the start of an author's HTML document: where its head begins, its
// first script, and the policies its meta elements declare. Pure: text in,
// positions out. The scan steps over comments, the text of scripts and the
// like, and everything inside a template, whatever tags they spell.

/** An attribute's value as written, with where it is written. */
export type AttributeValue = Readonly<{
  /** The value without its quotes. Character references are not decoded. */
  value: string
  /** Where the value starts in the document, its quotes included. */
  start: number
  /** Where the value ends in the document, its quotes included. */
  end: number
}>

/** A `<meta http-equiv="Content-Security-Policy">` of the document. */
export type PolicyMeta = Readonly<{
  /** Where the element starts. */
  start: number
  /** Where the element ends. */
  end: number
  /** Its first content attribute, or null when it has none. */
  content: AttributeValue | null
}>

export type DocumentHead = Readonly<{
  /** Where the head's content starts: after `<head>`, else `<html>`, else the doctype. */
  start: number
  /** Where the document's first script element starts, if before `<body>`. */
  firstScript: number | null
  /** The meta policies before `<body>`, in document order. */
  policies: readonly PolicyMeta[]
}>

const NOT_SPACE = /\S/g
const DOCTYPE = /<!doctype\b/iy

/**
 * Where the document's doctype ends, after nothing but a byte order mark,
 * white space and comments, or -1. Each comment is stepped over once, so
 * the time is linear in the text.
 */
function doctypeEnd(html: string): number {
  let at = html.startsWith('﻿') ? 1 : 0
  for (;;) {
    NOT_SPACE.lastIndex = at
    const next = NOT_SPACE.exec(html)
    if (!next) return -1
    at = next.index
    if (!html.startsWith('<!--', at)) break
    const end = html.indexOf('-->', at + 4)
    if (end === -1) return -1
    at = end + 3
  }
  DOCTYPE.lastIndex = at
  if (!DOCTYPE.test(html)) return -1
  const close = html.indexOf('>', at)
  return close === -1 ? -1 : close + 1
}

const ATTRIBUTE =
  /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/dg

/**
 * A start tag's attributes by lowercase name; the first of a name counts,
 * as in a browser. `offset` is where `text` starts in the document.
 */
function attributesOf(text: string, offset: number) {
  const attributes = new Map<string, AttributeValue>()
  for (const match of text.matchAll(ATTRIBUTE)) {
    const key = match[1].toLowerCase()
    if (attributes.has(key)) continue
    const group = [2, 3, 4].find((index) => match[index] !== undefined)
    const span = group === undefined ? undefined : match.indices?.[group]
    if (group === undefined || !span) {
      attributes.set(key, { value: '', start: -1, end: -1 })
      continue
    }
    const quoted = group !== 4 ? 1 : 0
    attributes.set(key, {
      value: match[group],
      start: offset + span[0] - quoted,
      end: offset + span[1] + quoted,
    })
  }
  return attributes
}

// The start of a tag, up to its name; its attributes follow.
const TAG_START = /<(\/?)([a-z][a-z0-9]*)\b/iy
const GREATER_THAN = 62
const DOUBLE_QUOTE = 34
const SINGLE_QUOTE = 39

/** The quote state after `code`: 0 outside a value, else the quote it is in. */
function quoteAfter(quote: number, code: number) {
  if (quote === 0)
    return code === DOUBLE_QUOTE || code === SINGLE_QUOTE ? code : 0
  return code === quote ? 0 : quote
}

const bit = (quote: number) =>
  quote === 0 ? 1 : quote === DOUBLE_QUOTE ? 2 : 4

/**
 * Finds where tags close: the first `>` outside a quoted value, as a quoted
 * value may hold `>`. A tag left open is read to the end of the file only
 * once per quote state: every later tag whose reading falls in with that
 * one is known to be open too. So a file of unclosed tags costs one pass
 * and not one per tag.
 */
function tagEnds(html: string) {
  // Per position, the quote states from which no `>` closes a tag.
  let open: Uint8Array | undefined
  const walk = (from: number, mark: Uint8Array | undefined) => {
    let quote = 0
    for (let at = from; at < html.length; at++) {
      if (open && open[at] & bit(quote)) return -1
      if (mark) mark[at] |= bit(quote)
      const code = html.charCodeAt(at)
      if (quote === 0 && code === GREATER_THAN) return at
      quote = quoteAfter(quote, code)
    }
    return -1
  }
  /** The index of the `>` closing a tag whose attributes start at `from`, or -1. */
  return (from: number) => {
    const end = walk(from, undefined)
    if (end === -1) {
      open ??= new Uint8Array(html.length)
      walk(from, open)
    }
    return end
  }
}

type Token =
  | Readonly<{ kind: 'comment'; end: number }>
  | Readonly<{
      kind: 'tag'
      end: number
      closing: boolean
      name: string
      text: string
      /** Where `text` starts in the document. */
      textStart: number
    }>

/**
 * The token that starts at the `<` at `at`: a comment, or a tag with its
 * attributes. Null when the `<` starts neither. An unclosed comment runs to
 * the end of the file.
 */
function tokenAt(
  html: string,
  at: number,
  endOfTag: (from: number) => number,
): Token | null {
  if (html.startsWith('<!--', at)) {
    const close = html.indexOf('-->', at + 4)
    return { kind: 'comment', end: close === -1 ? html.length : close + 3 }
  }
  TAG_START.lastIndex = at
  const start = TAG_START.exec(html)
  if (!start) return null
  const textStart = TAG_START.lastIndex
  const close = endOfTag(textStart)
  if (close === -1) return null
  return {
    kind: 'tag',
    end: close + 1,
    closing: start[1] === '/',
    name: start[2].toLowerCase(),
    text: html.slice(textStart, close),
    textStart,
  }
}

// Elements whose content is text up to their own end tag, whatever it spells.
const TEXT_ONLY = new Set([
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noscript',
  'noembed',
  'noframes',
])

/** Where the text of `name`, which starts at `from`, ends. */
function afterText(html: string, name: string, from: number) {
  const end = new RegExp(`</${name}\\s*>`, 'gi')
  end.lastIndex = from
  return end.exec(html) ? end.lastIndex : html.length
}

const isPolicy = (attributes: Map<string, AttributeValue>) =>
  attributes.get('http-equiv')?.value.trim().toLowerCase() ===
  'content-security-policy'

type Found = {
  head?: number
  html?: number
  firstScript?: number
  policies: PolicyMeta[]
  /** The document's `<body>` start tag was reached. */
  body: boolean
}

/** Notes a start tag of the document itself: one outside every template. */
function noteStartTag(
  found: Found,
  token: Token & { kind: 'tag' },
  at: number,
) {
  const { name } = token
  if (name === 'body') found.body = true
  else if (name === 'head') found.head ??= token.end
  else if (name === 'html') found.html ??= token.end
  else if (name === 'script') found.firstScript ??= at
  else if (name === 'meta') {
    const attributes = attributesOf(token.text, token.textStart)
    if (isPolicy(attributes))
      found.policies.push({
        start: at,
        end: token.end,
        content: attributes.get('content') ?? null,
      })
  }
}

/** Notes the token at `at`, if any, and gives where reading goes on. */
function readToken(
  html: string,
  at: number,
  token: Token | null,
  found: Found,
  depth: { templates: number },
) {
  if (!token) return at + 1
  if (token.kind === 'comment') return token.end
  let next = token.end
  if (token.name === 'template')
    depth.templates = Math.max(0, depth.templates + (token.closing ? -1 : 1))
  else if (!token.closing && TEXT_ONLY.has(token.name))
    next = afterText(html, token.name, next)
  if (depth.templates === 0 && !token.closing) noteStartTag(found, token, at)
  return next
}

/**
 * Reads the document's own markup up to its `<body>` start tag: a meta
 * policy after it is in the body, where browsers ignore it. Null when the
 * text does not start as a document does (no `<head>`, `<html>` or leading
 * doctype), such as a piece of HTML.
 */
export function readHead(html: string): DocumentHead | null {
  const found: Found = { policies: [], body: false }
  const endOfTag = tagEnds(html)
  const depth = { templates: 0 }
  let at = html.indexOf('<')
  while (at !== -1 && !found.body) {
    const token = tokenAt(html, at, endOfTag)
    at = html.indexOf('<', readToken(html, at, token, found, depth))
  }
  const doctype = doctypeEnd(html)
  const start = found.head ?? found.html ?? (doctype === -1 ? null : doctype)
  if (start === null) return null
  return {
    start,
    firstScript: found.firstScript ?? null,
    policies: found.policies,
  }
}
