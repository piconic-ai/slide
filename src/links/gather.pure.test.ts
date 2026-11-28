import { describe, expect, test } from 'vitest'
import { gatherKeyOf, linkHostOf } from './gather'
import { normalizedUrlOf } from './normalize'

const keyOf = (address: string) => gatherKeyOf(new URL(address).href)

const expectGathered = (...addresses: string[]) =>
  expect(new Set(addresses.map(keyOf)).size).toBe(1)

const expectApart = (...addresses: string[]) =>
  expect(new Set(addresses.map(keyOf)).size).toBe(addresses.length)

describe('gatherKeyOf', () => {
  test('F45-AC5: Given YouTube addresses of one video that differ in t, When they are gathered, Then they have one key, though they are compared as two links', () => {
    expectGathered(
      'https://youtu.be/ID?t=30',
      'https://www.youtube.com/watch?v=ID&t=5',
      'https://youtube.com/watch?v=ID&si=x&feature=share&pp=y',
      'https://m.youtube.com/shorts/ID',
    )
    expect(keyOf('https://youtu.be/ID?t=30')).toBe(
      'https://youtube.com/watch?v=ID',
    )
    expect(normalizedUrlOf('https://youtu.be/ID?t=30')).toBe(
      'https://youtube.com/watch?t=30&v=ID',
    )
  })

  test('F45-AC5: Given ニコニコ動画 addresses of one video that differ in from, When they are gathered, Then they have one key', () => {
    expectGathered(
      'https://www.nicovideo.jp/watch/sm9?from=30',
      'https://nico.ms/sm9',
      'https://sp.nicovideo.jp/watch/sm9?from=5',
    )
  })

  test('F45-AC5: Given t or from on a site they are not a start of, When it is gathered, Then the name stays', () => {
    expectApart('https://example.com/a?t=1', 'https://example.com/a?t=2')
    expectApart('https://youtu.be/ID?from=1', 'https://youtu.be/ID?from=2')
    // YouTube Music is another site (F27-AC75).
    expectApart(
      'https://music.youtube.com/watch?v=ID&t=1',
      'https://music.youtube.com/watch?v=ID&t=2',
      'https://youtube.com/watch?v=ID',
    )
  })

  test('F45-AC23: Given addresses that differ only in www., a trailing slash, tracking query names and what follows #, When they are gathered, Then they have one key', () => {
    expectGathered(
      'https://www.example.com/a/?utm_source=x&b=1#top',
      'https://example.com/a?b=1&fbclid=y',
      'HTTPS://Example.COM:443/a?b=1',
    )
  })

  test('F45-AC23: Given two videos of Vimeo with another private hash, When they are gathered, Then they stay apart', () => {
    expectApart('https://vimeo.com/1/abc', 'https://vimeo.com/1/def')
    expectGathered('https://vimeo.com/1/abc', 'https://vimeo.com/1?h=abc')
  })

  test('F45-AC23: Given an address in another script and a very long one, When they are gathered, Then the key is the written form and nothing is cut', () => {
    expect(keyOf('https://www.例え.jp/パス/?q=値')).toBe(
      'https://xn--r8jz45g.jp/%E3%83%91%E3%82%B9?q=%E5%80%A4',
    )
    const long = `https://example.com/${'a'.repeat(1900)}?t=${'9'.repeat(60)}`
    expect(keyOf(long)).toBe(long)
  })

  test('F45-AC5: Given any address, When its key is gathered again, Then the key does not change', () => {
    for (const address of [
      'https://youtu.be/ID?t=30&list=L',
      'https://nico.ms/sm9?from=3',
      'https://player.vimeo.com/video/1?h=abc',
      'https://www.loom.com/embed/x?t=2',
    ])
      expect(keyOf(keyOf(address))).toBe(keyOf(address))
  })
})

describe('linkHostOf', () => {
  test('F45-AC4: Given an address, When its host is read, Then it is in lower case, without a final dot and a port, and keeps www.', () => {
    expect(linkHostOf('https://WWW.Example.COM.:8443/a?b=1')).toBe(
      'www.example.com',
    )
    expect(linkHostOf('https://Group.connpass.com/event/1/')).toBe(
      'group.connpass.com',
    )
    expect(linkHostOf('https://例え.jp/')).toBe('xn--r8jz45g.jp')
  })
})
