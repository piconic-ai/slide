import { expect, test } from 'vitest'
import {
  isWholePagePath,
  movesInFrame,
  policyCovers,
  policyForRouter,
  regionHasForm,
  type LinkFacts,
} from './router-policy'

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

const AVATAR = 'https://avatars.githubusercontent.com'
const DECKS = new URL('https://slideusercontent.example')
const PLAIN = `default-src 'none'; script-src 'self'; connect-src 'self'; img-src ${AVATAR}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`

const directive = (policy: string, name: string) =>
  policy
    .split('; ')
    .find((part) => part.startsWith(`${name} `))
    ?.split(' ')
    .slice(1)

test('F03-AC70: Given a page that carries the router, When its policy is widened, Then it allows frames and pictures of any deck origin, and its form-action is the one it had', () => {
  const widened = policyForRouter(PLAIN, DECKS, AVATAR)
  expect(directive(widened, 'frame-src')).toEqual([
    "'self'",
    'https://*.slideusercontent.example',
  ])
  expect(directive(widened, 'img-src')).toEqual([
    AVATAR,
    "'self'",
    'https://*.slideusercontent.example',
  ])
  expect(directive(widened, 'form-action')).toEqual(["'none'"])
})

test('F03-AC70: Given a widened policy, When it is compared with the page policy, Then every other directive is the same', () => {
  const widened = policyForRouter(PLAIN, DECKS, AVATAR)
  for (const name of [
    'default-src',
    'script-src',
    'style-src',
    'base-uri',
    'frame-ancestors',
    'connect-src',
    'form-action',
  ])
    expect(directive(widened, name)).toEqual(directive(PLAIN, name))
})

test('F03-AC70: Given a policy without connect-src, When it is widened, Then same-origin requests are allowed', () => {
  const widened = policyForRouter(
    "default-src 'none'; script-src 'self'",
    null,
    AVATAR,
  )
  expect(directive(widened, 'connect-src')).toEqual(["'self'"])
  expect(directive(widened, 'frame-src')).toEqual(["'self'"])
})

test('F03-AC70: Given a viewer policy that names its deck origin, When it is widened, Then that origin stays first and its form-action stays', () => {
  const viewer = `default-src 'none'; frame-src https://d-1.slideusercontent.example 'self'; script-src 'self'; connect-src 'self'; form-action 'none'`
  const widened = policyForRouter(viewer, DECKS, AVATAR)
  expect(directive(widened, 'frame-src')).toEqual([
    'https://d-1.slideusercontent.example',
    "'self'",
    'https://*.slideusercontent.example',
  ])
  expect(directive(widened, 'form-action')).toEqual(["'none'"])
})

test('F03-AC70: Given the policy of a frame page with a nonce script, When it is widened, Then it is returned as it was', () => {
  const frame =
    "default-src 'none'; script-src 'nonce-abc'; frame-ancestors 'self'"
  expect(policyForRouter(frame, DECKS, AVATAR)).toBe(frame)
})

const FORMS = `default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; img-src ${AVATAR}; form-action 'self' https://github.com`
const VIEWER = `default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; img-src 'self' ${AVATAR} https://*.slideusercontent.example; frame-src https://d-1.slideusercontent.example 'self'; form-action 'none'`

test('F03-AC73: Given a page that allows no form, When a page with a form is to be moved in, Then it is not; and a page without a form is', () => {
  const plain = policyForRouter(PLAIN, DECKS, AVATAR)
  const forms = policyForRouter(FORMS, DECKS, AVATAR)
  expect(policyCovers(plain, forms, true)).toBe(false)
  expect(policyCovers(plain, forms, false)).toBe(true)
  expect(policyCovers(forms, plain, true)).toBe(true)
})

test('F03-AC73: Given a page without the wildcard for pictures, When a page with covers is to be moved in, Then it is not', () => {
  const widened = policyForRouter(FORMS, null, AVATAR)
  expect(policyCovers(widened, VIEWER, false)).toBe(false)
  expect(
    policyCovers(policyForRouter(FORMS, DECKS, AVATAR), VIEWER, false),
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

test('F03-AC55: Given the consent screen of an agent and the pages that leave the frame, When their paths are asked, Then they are whole pages, and a link on them is a page load', () => {
  for (const path of ['/oauth/authorize', '/auth/github', '/embed/@a/b'])
    expect(isWholePagePath(path)).toBe(true)
  expect(isWholePagePath('/help')).toBe(false)
  expect(
    movesInFrame(
      link({
        from: 'https://slide.example/oauth/authorize?x=1',
        href: 'https://slide.example/help',
      }),
    ),
  ).toBe(false)
})
