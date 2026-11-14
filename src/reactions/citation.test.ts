import { expect, test } from 'vitest'
import {
  citationOfHref,
  citationsOf,
  MAX_CITATIONS,
  mergeCitations,
} from './citation'

const ORIGIN = 'https://slide.example'

test('Given a link to a page of a deck, When read, Then it cites that page', () => {
  expect(citationOfHref(`${ORIGIN}/@kfly8/talk/6`, ORIGIN)).toEqual({
    handle: 'kfly8',
    slug: 'talk',
    page: 6,
  })
})

test('Given a link to a deck, When read, Then it cites the whole deck as page 0', () => {
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
  ['a service page', `${ORIGIN}/decks`],
  ['a non-canonical spelling', `${ORIGIN}/@KFly8/talk`],
  ['page zero', `${ORIGIN}/@kfly8/talk/0`],
  ['a relative link', '/@kfly8/talk'],
  ['a script URL', 'javascript:alert(1)'],
  ['an empty value', ''],
])('Given %s, When read, Then it is not a citation', (_, href) => {
  expect(citationOfHref(href, ORIGIN)).toBeNull()
})

test('Given HTML with several links, When read, Then citations come in document order without repeats', () => {
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

test('Given files citing the same page and the deck itself, When merged, Then repeats and self links are dropped', () => {
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
