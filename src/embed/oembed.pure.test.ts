import { expect, test } from 'vitest'
import { oembedResponse, oembedSize, oembedUrl, parseOEmbedUrl } from './oembed'

const ORIGIN = 'https://slide.example'

test.each([
  ['the slides', `${ORIGIN}/@owner/talk`],
  ['one of their pages', `${ORIGIN}/@owner/talk/3`],
  ['the slides with a query and a fragment', `${ORIGIN}/@owner/talk?lang=en#x`],
])(
  'F25-AC6: Given the share URL of %s, When it is read for oEmbed, Then it names the slides',
  (_, url) => {
    expect(parseOEmbedUrl(url, ORIGIN)).toEqual({
      handle: 'owner',
      slug: 'talk',
    })
  },
)

test.each([
  ['nothing', undefined],
  ['an empty string', ''],
  ['a list', [`${ORIGIN}/@owner/talk`]],
  ['a path alone', '/@owner/talk'],
  ['no URL', 'not a url'],
  ['another site', 'https://elsewhere.example/@owner/talk'],
  [
    'a host that only starts alike',
    'https://slide.example.evil.example/@owner/talk',
  ],
  ['another scheme', 'http://slide.example/@owner/talk'],
  ['another port', 'https://slide.example:8443/@owner/talk'],
  ['credentials in the URL', 'https://user:pass@slide.example/@owner/talk'],
  ['a profile', `${ORIGIN}/@owner`],
  ['the top page', `${ORIGIN}/`],
  ['the page to frame itself', `${ORIGIN}/embed/@owner/talk`],
  ['a management page', `${ORIGIN}/my/slides/talk`],
  ['another spelling of the share URL', `${ORIGIN}/@Owner/talk/`],
  ['a page number no share URL has', `${ORIGIN}/@owner/talk/0`],
  ['a script URL', 'javascript:alert(1)'],
])(
  'F25-AC6: Given %s, When it is read for oEmbed, Then it names nothing',
  (_, url) => {
    expect(parseOEmbedUrl(url, ORIGIN)).toBeNull()
  },
)

test.each([
  ['no limits', undefined, undefined, 960, 585],
  ['a narrower column', '480', undefined, 480, 315],
  ['a lower frame', undefined, '90', 80, 90],
  ['both, the height binding', '800', '180', 240, 180],
  ['both, the width binding', '320', '1000', 320, 225],
  ['limits above the size', '4000', '4000', 960, 585],
  ['a measured width with a fraction', '652.8', undefined, 652, 411],
  ['a whole width written with a fraction', '640.0', undefined, 640, 405],
  ['a measured height with a fraction', undefined, '300.5', 453, 299],
  ['a width just under the size', '959.999', undefined, 959, 584],
  ['a width of one pixel', '1', undefined, 1, 46],
  ['the lowest height with room for slides', undefined, '46', 1, 46],
  ['a width with leading zeros', '0480', undefined, 480, 315],
  ['a very large limit', '999999999.999999999', '999999999', 960, 585],
])(
  'F25-AC6, F25-AC8: Given %s, When the size to report is chosen, Then it is 16:9 slides and the line under them, in whole pixels, and never larger than a limit',
  (_, maxwidth, maxheight, width, height) => {
    expect(oembedSize(maxwidth, maxheight)).toEqual({ width, height })
    expect(height - 45).toBe(Math.max(1, Math.floor((width * 9) / 16)))
    expect(width).toBeLessThanOrEqual(Number(maxwidth ?? Infinity))
    expect(height).toBeLessThanOrEqual(Number(maxheight ?? Infinity))
  },
)

test.each([
  ['zero', '0'],
  ['zero with a fraction', '0.0'],
  ['less than one pixel', '0.9'],
  ['a negative number', '-5'],
  ['an empty value', ''],
  ['words', 'wide'],
  ['a number with a unit', '480px'],
  ['an exponent', '1e3'],
  ['a hexadecimal number', '0x1e0'],
  ['infinity', 'Infinity'],
  ['a number with spaces', ' 480 '],
  ['a number with a sign', '+480'],
  ['a number with only a point', '480.'],
  ['a number too long to be a size', '1234567890'],
  ['a repeated parameter', ['100', '200']],
])(
  'F25-AC6: Given a limit that is %s, When the size to report is chosen, Then no size is promised, whichever limit it was',
  (_, value) => {
    expect(oembedSize(value, undefined)).toBeNull()
    expect(oembedSize(undefined, value)).toBeNull()
    expect(oembedSize('480', value)).toBeNull()
  },
)

test.each([
  ['one pixel', '1'],
  ['the height of the line', '45'],
  ['less than a pixel above the line', '45.9'],
])(
  'F25-AC6: Given a height limit of %s, which leaves no room for slides above the line, When the size to report is chosen, Then no size is promised',
  (_, maxheight) => {
    expect(oembedSize(undefined, maxheight)).toBeNull()
    expect(oembedSize('480', maxheight)).toBeNull()
  },
)

test('F25-AC6: Given every pair of whole limits up to 100 pixels, and some above, When the size to report is chosen, Then it fits both whenever the height has room for slides above the line', () => {
  const limits = [
    ...Array.from({ length: 100 }, (_, i) => i + 1),
    584,
    585,
    586,
    959,
    960,
    961,
    5000,
  ]
  for (const w of limits)
    for (const h of limits) {
      const size = oembedSize(String(w), String(h))
      if (h <= 45) {
        expect(size).toBeNull()
        continue
      }
      expect(size).not.toBeNull()
      expect(size?.width).toBeGreaterThanOrEqual(1)
      expect(size?.height).toBeGreaterThanOrEqual(46)
      expect(size?.width).toBeLessThanOrEqual(Math.min(w, 960))
      expect(size?.height).toBeLessThanOrEqual(Math.min(h, 585))
    }
})

test('F25-AC6: Given public slides, When the answer is built, Then it is rich content with the fields a consumer needs', () => {
  expect(
    oembedResponse({
      html: '<iframe></iframe>',
      title: 'Good talk',
      authorName: 'Owner',
      authorUrl: `${ORIGIN}/@owner`,
      publicOrigin: `${ORIGIN}/`,
      size: { width: 960, height: 540 },
    }),
  ).toEqual({
    type: 'rich',
    version: '1.0',
    title: 'Good talk',
    author_name: 'Owner',
    author_url: `${ORIGIN}/@owner`,
    provider_name: 'slide.community',
    provider_url: ORIGIN,
    html: '<iframe></iframe>',
    width: 960,
    height: 540,
  })
})

test('F25-AC9: Given a share URL, When the address for discovery is built, Then asking it names that URL and JSON', () => {
  const url = new URL(oembedUrl(`${ORIGIN}/@owner/talk`))
  expect(url.origin + url.pathname).toBe(`${ORIGIN}/oembed`)
  expect(Object.fromEntries(url.searchParams)).toEqual({
    url: `${ORIGIN}/@owner/talk`,
    format: 'json',
  })
})
