import { expect, test } from 'vitest'
import {
  citationOfHref,
  citationsOf,
  MAX_CITATIONS,
  MAX_LINKS_EXAMINED,
  mergeCitations,
} from './citation'

const ORIGIN = 'https://slide.example'

test('F24-AC1: Given a link to a page of a deck, When read, Then it cites that page', () => {
  expect(citationOfHref(`${ORIGIN}/@kfly8/talk/6`, ORIGIN)).toEqual({
    handle: 'kfly8',
    slug: 'talk',
    page: 6,
  })
})

test('F24-AC1: Given a link to a deck, When read, Then it cites the whole deck as page 0', () => {
  expect(citationOfHref(`${ORIGIN}/@kfly8/talk`, ORIGIN)).toEqual({
    handle: 'kfly8',
    slug: 'talk',
    page: 0,
  })
})

test('Given a link with a query and fragment, When read, Then they are ignored', () => {
  expect(citationOfHref(`${ORIGIN}/@kfly8/talk/6?lang=en#x`, ORIGIN)).toEqual({
    handle: 'kfly8',
    slug: 'talk',
    page: 6,
  })
})

test.each([
  ['another origin', 'https://elsewhere.example/@kfly8/talk'],
  ['a lookalike host', 'https://slide.example.evil.example/@kfly8/talk'],
  ['another scheme', 'http://slide.example/@kfly8/talk'],
  ['a profile', `${ORIGIN}/@kfly8`],
  ['a service page', `${ORIGIN}/my/slides`],
  ['page zero', `${ORIGIN}/@kfly8/talk/0`],
  ['a relative link', '/@kfly8/talk'],
  ['a script URL', 'javascript:alert(1)'],
  [
    'the origin as a user name',
    'https://slide.example@evil.example/@kfly8/talk',
  ],
  ['a page past the last one', `${ORIGIN}/@kfly8/talk/10000`],
  ['a path under a deck', `${ORIGIN}/@kfly8/talk/6/notes`],
  ['text that is no URL', 'not a url'],
  ['an empty value', ''],
])('F24-AC1: Given %s, When read, Then it is not a citation', (_, href) => {
  expect(citationOfHref(href, ORIGIN)).toBeNull()
})

test('F24-AC3: Given HTML with several links, When read, Then citations come in document order without repeats', () => {
  const html = `<section>
    <a href="${ORIGIN}/@kfly8/talk/24">adversarial</a>
    <a class="x" href='${ORIGIN}/@kfly8/talk/6'>counter</a>
    <a href="${ORIGIN}/@kfly8/talk/24">again</a>
    <a href="https://example.com/">elsewhere</a>
    <a href="${ORIGIN}/@other/deck?a=1&amp;b=2">encoded</a>
  </section>`
  expect(citationsOf(html, ORIGIN)).toEqual([
    { handle: 'kfly8', slug: 'talk', page: 24 },
    { handle: 'kfly8', slug: 'talk', page: 6 },
    { handle: 'other', slug: 'deck', page: 0 },
  ])
})

test('Given HTML without links, When read, Then there are no citations', () => {
  expect(citationsOf('<p>href is only a word here</p>', ORIGIN)).toEqual([])
  expect(citationsOf('', ORIGIN)).toEqual([])
})

test('Given a character reference in the link, When read, Then it is decoded first', () => {
  expect(
    citationsOf(`<a href="${ORIGIN}/&#64;kfly8/talk/2">x</a>`, ORIGIN),
  ).toEqual([{ handle: 'kfly8', slug: 'talk', page: 2 }])
})

test.each([
  ['an area of an image map', `<area href="${ORIGIN}/@kfly8/talk/6">`],
  [
    'a link in an SVG',
    `<svg><a xlink:href="${ORIGIN}/@kfly8/talk/6"></a></svg>`,
  ],
  ['upper case markup', `<A HREF="${ORIGIN}/@kfly8/talk/6">x</A>`],
  ['spaces around the sign', `<a href = "${ORIGIN}/@kfly8/talk/6">x</a>`],
  ['a value on its own line', `<a href="\n  ${ORIGIN}/@kfly8/talk/6\n">x</a>`],
  ['a bare value', `<a href=${ORIGIN}/@kfly8/talk/6>x</a>`],
  [
    'a bare value before another attribute',
    `<a href=${ORIGIN}/@kfly8/talk/6 class=x>x</a>`,
  ],
  ['a tag that is never closed', `<div><a href="${ORIGIN}/@kfly8/talk/6">x<p>`],
  [
    'markup a script writes',
    `<script>page.innerHTML = '<a href="${ORIGIN}/@kfly8/talk/6">x</a>'</script>`,
  ],
  [
    'a link inside a comment',
    `<!-- <a href="${ORIGIN}/@kfly8/talk/6">x</a> -->`,
  ],
])(
  'F24-AC1: Given %s, When the HTML is read, Then the link is a citation',
  (_, html) => {
    expect(citationsOf(html, ORIGIN)).toEqual([
      { handle: 'kfly8', slug: 'talk', page: 6 },
    ])
  },
)

test.each([
  ['a URL in the text', `<p>${ORIGIN}/@kfly8/talk/6</p>`],
  ['an image source', `<img src="${ORIGIN}/@kfly8/talk/6">`],
  ['a form action', `<form action="${ORIGIN}/@kfly8/talk/6"></form>`],
  [
    'a meta value',
    `<meta property="og:url" content="${ORIGIN}/@kfly8/talk/6">`,
  ],
  [
    'a URL a script keeps in a variable',
    `<script>const to = "${ORIGIN}/@kfly8/talk/6"</script>`,
  ],
  ['a relative link', '<a href="/@kfly8/talk/6">x</a>'],
  [
    'a link elsewhere',
    '<a href="https://elsewhere.example/@kfly8/talk/6">x</a>',
  ],
  ['a quote that never closes', `<a href="${ORIGIN}/@kfly8/talk/6>x</a>`],
  ['an empty bare value', '<a href= >x</a>'],
  ['only the attribute name', '<a href>x</a><a href=>y</a>'],
])(
  'F24-AC1: Given %s, When the HTML is read, Then it is not a citation',
  (_, html) => {
    expect(citationsOf(html, ORIGIN)).toEqual([])
  },
)

test('Given a very long text of unfinished links, When read, Then it ends without a citation', () => {
  const html = '<a href='.repeat(50_000) + '"'.repeat(50_000)

  expect(citationsOf(html, ORIGIN)).toEqual([])
})

test('F24-AC4: Given a link to another deck of the same author, When merged, Then it is kept', () => {
  const sequel = { handle: 'reader', slug: 'sequel', page: 0 }
  expect(
    mergeCitations([[sequel]], { handle: 'reader', slug: 'reply' }),
  ).toEqual([sequel])
})

test('F24-AC4: Given files citing the same page and the deck itself, When merged, Then repeats and self links are dropped', () => {
  const page = { handle: 'kfly8', slug: 'talk', page: 6 }
  const self = { handle: 'reader', slug: 'reply', page: 2 }
  expect(
    mergeCitations([[page, self], [page]], { handle: 'reader', slug: 'reply' }),
  ).toEqual([page])
})

test('Given a deck whose owner has no handle yet, When merged, Then nothing counts as a self link', () => {
  const page = { handle: 'kfly8', slug: 'talk', page: 6 }
  expect(mergeCitations([[page]], { handle: null, slug: 'talk' })).toEqual([
    page,
  ])
})

test('Given more citations than the limit, When merged, Then only the first ones are kept', () => {
  const many = Array.from({ length: MAX_CITATIONS + 5 }, (_, index) => ({
    handle: 'kfly8',
    slug: 'talk',
    page: index + 1,
  }))
  const kept = mergeCitations([many], { handle: null, slug: null })
  expect(kept).toHaveLength(MAX_CITATIONS)
  expect(kept.at(-1)?.page).toBe(MAX_CITATIONS)
})

test.each([
  ['a handle in upper case', `${ORIGIN}/@KFly8/talk/6`],
  ['a trailing slash', `${ORIGIN}/@kfly8/talk/6/`],
  ['an encoded at sign', `${ORIGIN}/%40kfly8/talk/6`],
  ['a zero-padded page', `${ORIGIN}/@kfly8/talk/06`],
  ['an origin in upper case', 'HTTPS://SLIDE.EXAMPLE/@kfly8/talk/6'],
])(
  'F24-AC1: Given %s, a spelling the viewer follows to the same deck, When read, Then it cites the deck under its one name',
  (_, href) => {
    expect(citationOfHref(href, ORIGIN)).toEqual({
      handle: 'kfly8',
      slug: 'talk',
      page: 6,
    })
  },
)

test('Given more links under the service’s origin than one text may have examined, When read, Then the reading stops at the limit and keeps what it found before', () => {
  const broken = `<a href="${ORIGIN}/@kfly8/not a deck">x</a>`
  const html =
    `<a href="${ORIGIN}/@kfly8/first">first</a>` +
    broken.repeat(MAX_LINKS_EXAMINED) +
    `<a href="${ORIGIN}/@kfly8/late">late</a>`

  expect(citationsOf(html, ORIGIN)).toEqual([
    { handle: 'kfly8', slug: 'first', page: 0 },
  ])
})

test.each([
  ['a slug', `<a href=${ORIGIN}/@kfly8/talk-lo`],
  ['a page number', `<a href=${ORIGIN}/@kfly8/talk/1`],
  ['a handle', `<a href=${ORIGIN}/@kfl`],
])(
  'F24-AC1: Given a text cut off in the middle of a bare link, at %s, When read as cut, Then the cut link is not a citation, while links before it are',
  (_, tail) => {
    const html = `<a href=${ORIGIN}/@kfly8/whole>x</a> ${tail}`

    expect(citationsOf(html, ORIGIN, { cut: true })).toEqual([
      { handle: 'kfly8', slug: 'whole', page: 0 },
    ])
  },
)

test('F24-AC1: Given a whole text that ends with a bare link, When read, Then the link is a citation', () => {
  expect(citationsOf(`<a href=${ORIGIN}/@kfly8/talk/12`, ORIGIN)).toEqual([
    { handle: 'kfly8', slug: 'talk', page: 12 },
  ])
})

test('Given a cut text that ends with a closed quoted link, When read as cut, Then the link is a citation', () => {
  expect(
    citationsOf(`<a href="${ORIGIN}/@kfly8/talk/12"`, ORIGIN, { cut: true }),
  ).toEqual([{ handle: 'kfly8', slug: 'talk', page: 12 }])
})
