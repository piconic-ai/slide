import { expect, test } from 'vitest'
import {
  isWholePagePath,
  movesInFrame,
  policyCovers,
  regionHasForm,
  type LinkFacts,
} from './router-policy'

const HERE = 'https://slide.example/slides/talk'
const link = (over: Partial<LinkFacts>): LinkFacts => ({
  href: 'https://slide.example/help',
  from: HERE,
  router: undefined,
  download: false,
  target: null,
  rel: null,
  ...over,
})

test.each(['/help', '/@alice', '/slides/talk', '/slides', '/settings', '/'])(
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

const AVATAR = 'https://avatars.githubusercontent.com'
const PLAIN = `default-src 'none'; script-src 'self'; connect-src 'self'; img-src ${AVATAR}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
const FORMS = `default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; img-src ${AVATAR}; form-action 'self' https://github.com`
const COVERS = `default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; img-src ${AVATAR} 'self' https://*.slideusercontent.example; form-action 'self' https://github.com`

test('F03-AC73: Given a page that allows no form, When a page with a form is to be moved in, Then it is not; and a page without a form is', () => {
  expect(policyCovers(PLAIN, FORMS, true)).toBe(false)
  expect(policyCovers(PLAIN, FORMS, false)).toBe(true)
  expect(policyCovers(FORMS, PLAIN, true)).toBe(true)
})

test('F03-AC73: Given a page without the wildcard for pictures, When a page with covers is to be moved in, Then it is not', () => {
  expect(policyCovers(FORMS, COVERS, false)).toBe(false)
  expect(policyCovers(COVERS, FORMS, false)).toBe(true)
  expect(
    policyCovers(
      COVERS,
      `${FORMS}; img-src https://d-1.slideusercontent.example`,
      false,
    ),
  ).toBe(true)
})

test('F03-AC73: Given a policy that names nothing for a directive, When a page asking for it is to be moved in, Then default-src decides, and an absent form-action allows every form', () => {
  expect(
    policyCovers(
      "default-src 'none'",
      "default-src 'none'; img-src 'self'",
      false,
    ),
  ).toBe(false)
  expect(
    policyCovers(
      "default-src 'self'",
      "default-src 'none'; img-src 'self'",
      false,
    ),
  ).toBe(true)
  expect(policyCovers("default-src 'none'", "form-action 'self'", true)).toBe(
    true,
  )
  expect(
    policyCovers(
      "default-src 'none'; form-action 'none'",
      "form-action 'none'",
      true,
    ),
  ).toBe(true)
})

test('F03-AC73: Given the markup of a page, When it is asked whether the region holds a form, Then only a form inside the region counts', () => {
  expect(
    regionHasForm('<main bf-region="page"><form action="/x"></form></main>'),
  ).toBe(true)
  expect(
    regionHasForm('<form></form><main bf-region="page"><p></p></main>'),
  ).toBe(false)
  expect(regionHasForm('<p>no region</p>')).toBe(false)
})

test.each([
  '/@owner/talk',
  '/@owner/talk/3',
  '/oauth/authorize',
  '/auth/github',
  '/embed/@a/b',
])(
  'F03-AC72: Given the path %s, When it is asked, Then it is a whole page, and a link to or from it is a page load',
  (path) => {
    expect(isWholePagePath(path)).toBe(true)
    expect(movesInFrame(link({ href: `https://slide.example${path}` }))).toBe(
      false,
    )
    expect(
      movesInFrame(
        link({
          from: `https://slide.example${path}`,
          href: 'https://slide.example/help',
        }),
      ),
    ).toBe(false)
  },
)

test.each([
  '/',
  '/@owner',
  '/slides',
  '/slides/talk',
  '/settings',
  '/help',
  '/notifications',
])(
  'F03-AC49: Given the path %s, When it is asked, Then it is a page of the frame',
  (path) => {
    expect(isWholePagePath(path)).toBe(false)
  },
)
