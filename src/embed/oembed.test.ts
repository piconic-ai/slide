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
  ['a management page', `${ORIGIN}/slides/talk`],
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
  ['no limits', undefined, undefined, 960, 540],
  ['a narrower column', '480', undefined, 480, 270],
  ['a lower frame', undefined, '90', 160, 90],
  ['both, the height binding', '800', '180', 320, 180],
  ['both, the width binding', '320', '1000', 320, 180],
  ['limits above the size', '4000', '4000', 960, 540],
  ['a width of one pixel', '1', undefined, 1, 1],
  ['a height of one pixel', undefined, '1', 1, 1],
  ['zero', '0', '0', 960, 540],
  ['a negative number', '-5', undefined, 960, 540],
  ['a fraction', '480.5', undefined, 960, 540],
  ['words', 'wide', 'tall', 960, 540],
  ['a number too long to be a size', '9999999', undefined, 960, 540],
  ['a repeated parameter', ['100', '200'], undefined, 960, 540],
])(
  'F25-AC6: Given %s, When the size to report is chosen, Then it is 16:9 within the limits that are whole pixel counts',
  (_, maxwidth, maxheight, width, height) => {
    expect(oembedSize(maxwidth, maxheight)).toEqual({ width, height })
  },
)

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
    provider_name: 'Slide',
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
