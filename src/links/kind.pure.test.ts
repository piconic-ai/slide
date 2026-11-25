import { describe, expect, test } from 'vitest'
import { KIND_HOSTS } from './kind-hosts'
import { kindOfUrl } from './kind'

describe('kindOfUrl', () => {
  test.each([
    'https://kanagawapm.connpass.com/event/410635/',
    'https://connpass.com/event/410635/',
    'https://rubykaigi.doorkeeper.jp/events/12345',
    'https://luma.com/abcd1234',
    'https://lu.ma/abcd1234',
  ])(
    'F27-AC47: Given the event address %s, When its kind is read, Then it is an event',
    (address) => {
      expect(kindOfUrl(address)).toBe('event')
    },
  )

  test.each([
    'https://kanagawapm.connpass.com/',
    'https://luma.com/discover',
    'https://doorkeeper.jp/events/1',
    'https://www.youtube.com/watch?v=https://connpass.com/event/1/',
  ])(
    'F27-AC47: Given the address %s, which is no event page, When its kind is read, Then it is not an event',
    (address) => {
      expect(kindOfUrl(address)).not.toBe('event')
    },
  )

  test.each([
    'https://www.youtube.com/watch?v=abc',
    'https://youtube.com/watch?v=abc',
    'https://m.youtube.com/watch?v=abc',
    'https://music.youtube.com/',
    'https://youtu.be/abc',
    'https://vimeo.com/123',
    'https://player.vimeo.com/video/1',
    'https://www.nicovideo.jp/watch/sm9',
    'https://nico.ms/sm9',
    'https://www.twitch.tv/videos/1',
    'https://www.loom.com/share/abc',
  ])(
    'F27-AC47: Given the video address %s, When its kind is read, Then it is a video',
    (address) => {
      expect(kindOfUrl(address)).toBe('video')
    },
  )

  test.each([
    'https://zenn.dev/kfly8/articles/x',
    'https://qiita.com/kfly8/items/x',
    'https://note.com/kfly8/n/x',
    'https://medium.com/@kfly8/x',
    'https://kfly8.medium.com/x',
    'https://dev.to/kfly8/x',
    'https://kfly8.substack.com/p/x',
    'https://kfly8.hatenablog.com/entry/x',
    'https://kfly8.hatenablog.jp/entry/x',
    'https://kfly8.hateblo.jp/entry/x',
    'https://kfly8.hatenadiary.com/entry/x',
    'https://kfly8.hatenadiary.jp/entry/x',
    'https://d.hatena.ne.jp/kfly8/',
  ])(
    'F27-AC47: Given the article address %s, When its kind is read, Then it is an article',
    (address) => {
      expect(kindOfUrl(address)).toBe('article')
    },
  )

  test.each([
    'https://speakerdeck.com/kfly8/x',
    'https://github.com/kfly8/slide',
    'https://example.com/',
    'https://b.hatena.ne.jp/entry/x',
    'https://x.com/kfly8/status/1',
    'https://slideshare.net/x',
  ])(
    'F27-AC47: Given the address %s that is not told apart, When its kind is read, Then it is other',
    (address) => {
      expect(kindOfUrl(address)).toBe('other')
    },
  )

  test('F27-AC47: Given capitals, a trailing dot and a port, When the kind is read, Then the host is what counts', () => {
    expect(kindOfUrl('https://WWW.YouTube.COM/watch')).toBe('video')
    expect(kindOfUrl('https://zenn.dev./x')).toBe('article')
    expect(kindOfUrl('https://zenn.dev:443/x')).toBe('article')
    expect(kindOfUrl('HTTPS://Qiita.com/x')).toBe('article')
  })

  test('F27-AC47: Given a host that only ends or begins like a listed one, When the kind is read, Then it is not taken for it', () => {
    expect(kindOfUrl('https://notyoutube.com/')).toBe('other')
    expect(kindOfUrl('https://youtube.com.evil.example/')).toBe('other')
    expect(kindOfUrl('https://evilzenn.dev/')).toBe('other')
    expect(kindOfUrl('https://zenn.dev.example/')).toBe('other')
    expect(kindOfUrl('https://example.com/youtube.com')).toBe('other')
    expect(kindOfUrl('https://example.com/?u=https://youtu.be/x')).toBe('other')
    expect(kindOfUrl('https://user@example.com/@youtube.com')).toBe('other')
  })

  test('F27-AC47: Given an internationalized look-alike of a listed host, When the kind is read, Then it is other (the ASCII form is compared)', () => {
    // A Cyrillic "у" in place of the Latin "y".
    expect(kindOfUrl('https://уoutube.com/watch')).toBe('other')
    expect(new URL('https://уoutube.com/').hostname).toMatch(/^xn--/)
    expect(kindOfUrl('https://日本語.jp/')).toBe('other')
    expect(kindOfUrl('https://xn--wgv71a119e.jp/')).toBe('other')
  })

  test('F27-AC47: Given text that is not an address, When the kind is read, Then it is other', () => {
    expect(kindOfUrl('')).toBe('other')
    expect(kindOfUrl('youtube.com')).toBe('other')
    expect(kindOfUrl('not a url')).toBe('other')
  })

  test('F27-AC47: Given the list, When it is read, Then no name is in two kinds and every name is a lower-case host with no scheme or path', () => {
    const all = [...KIND_HOSTS.video, ...KIND_HOSTS.article]
    expect(new Set(all).size).toBe(all.length)
    for (const name of all) expect(name).toMatch(/^[a-z0-9.-]+\.[a-z]+$/)
  })
})
