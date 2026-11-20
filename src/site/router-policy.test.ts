import { expect, test } from 'vitest'
import { movesInFrame, type LinkFacts } from './router-policy'

const HERE = 'https://slide.example/@kfly8/talk'
const link = (over: Partial<LinkFacts>): LinkFacts => ({
  href: 'https://slide.example/help',
  from: HERE,
  router: undefined,
  download: false,
  target: null,
  rel: null,
  ...over,
})

test.each(['/help', '/@alice', '/@alice/talk/3', '/slides', '/settings', '/'])(
  'F03-AC49: Given a link to the service page %s, When it is followed, Then the page moves inside the frame',
  (path) => {
    expect(movesInFrame(link({ href: `https://slide.example${path}` }))).toBe(
      true,
    )
  },
)

test.each(['/auth/github', '/auth/github?to=settings', '/auth/logout'])(
  'F03-AC55: Given a sign-in or sign-out link %s, When it is followed, Then it is a whole page load',
  (path) => {
    expect(movesInFrame(link({ href: `https://slide.example${path}` }))).toBe(
      false,
    )
  },
)

test('F03-AC55: Given the account deletion path, When it is followed, Then it is a whole page load', () => {
  expect(
    movesInFrame(link({ href: 'https://slide.example/account/delete' })),
  ).toBe(false)
})

test('F03-AC56: Given a link to another site or to the slides own origin, When it is followed, Then it is a whole page load', () => {
  expect(movesInFrame(link({ href: 'https://github.com/kfly8' }))).toBe(false)
  expect(
    movesInFrame(
      link({ href: 'https://d-abc.slideusercontent.com/index.html' }),
    ),
  ).toBe(false)
})

test.each([
  ['a download', { download: true }],
  ['a new tab', { target: '_blank' }],
  ['an external relation', { rel: 'noopener external' }],
  ['an opt-out', { router: 'false' }],
])(
  'F03-AC69: Given a link that is %s, When it is followed, Then it is a whole page load',
  (_name, over) => {
    expect(movesInFrame(link(over))).toBe(false)
  },
)

test('F03-AC49: Given a link whose target is the same frame, When it is followed, Then it moves inside the frame', () => {
  expect(movesInFrame(link({ target: '_self' }))).toBe(true)
})

test('F03-AC49: Given a link to a place on the same page, When it is followed, Then the browser scrolls to it', () => {
  expect(movesInFrame(link({ href: `${HERE}#notes` }))).toBe(false)
  expect(
    movesInFrame(
      link({ href: 'https://slide.example/help#share', from: HERE }),
    ),
  ).toBe(true)
})

test('F03-AC49: Given the language switch, When it is followed, Then it is a whole page load', () => {
  expect(movesInFrame(link({ href: `${HERE}?lang=en` }))).toBe(false)
})

test('F03-AC49: Given addresses that cannot be read, When they are followed, Then it is a whole page load', () => {
  expect(movesInFrame(link({ href: 'not a url' }))).toBe(false)
  expect(movesInFrame(link({ from: 'nowhere' }))).toBe(false)
})
