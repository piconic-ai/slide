import { expect, test } from 'vitest'
import { movesInFrame, policyForRouter, type LinkFacts } from './router-policy'

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

test('F03-AC63: Given a page that carries the router, When its policy is widened, Then the frames, forms and pictures a moved-to page needs are allowed', () => {
  const widened = policyForRouter(PLAIN, DECKS, AVATAR)
  expect(directive(widened, 'frame-src')).toEqual([
    "'self'",
    'https://*.slideusercontent.example',
  ])
  expect(directive(widened, 'form-action')).toEqual([
    "'self'",
    'https://github.com',
    'https://*.slideusercontent.example',
  ])
  expect(directive(widened, 'img-src')).toEqual([
    AVATAR,
    "'self'",
    'https://*.slideusercontent.example',
  ])
})

test('F03-AC63: Given a widened policy, When it is compared with the page policy, Then default-src, script-src, style-src, base-uri and frame-ancestors are unchanged', () => {
  const widened = policyForRouter(PLAIN, DECKS, AVATAR)
  for (const name of [
    'default-src',
    'script-src',
    'style-src',
    'base-uri',
    'frame-ancestors',
    'connect-src',
  ])
    expect(directive(widened, name)).toEqual(directive(PLAIN, name))
})

test('F03-AC63: Given a policy without connect-src, When it is widened, Then same-origin requests are allowed', () => {
  const widened = policyForRouter(
    "default-src 'none'; script-src 'self'",
    null,
    AVATAR,
  )
  expect(directive(widened, 'connect-src')).toEqual(["'self'"])
  expect(directive(widened, 'frame-src')).toEqual(["'self'"])
})

test('F03-AC64: Given a policy that already names one deck origin, When it is widened, Then that origin stays and the deck sandbox is not part of the policy', () => {
  const viewer = `default-src 'none'; frame-src https://d-1.slideusercontent.example 'self'; script-src 'self'; connect-src 'self'; form-action https://d-1.slideusercontent.example 'self'`
  const widened = policyForRouter(viewer, DECKS, AVATAR)
  expect(directive(widened, 'frame-src')).toContain(
    'https://d-1.slideusercontent.example',
  )
  expect(directive(widened, 'form-action')).toContain(
    'https://d-1.slideusercontent.example',
  )
  expect(widened).not.toContain('sandbox')
})

test('F03-AC63: Given the policy of a frame page with a nonce script, When it is widened, Then it is returned as it was', () => {
  const frame =
    "default-src 'none'; script-src 'nonce-abc'; frame-ancestors 'self'"
  expect(policyForRouter(frame, DECKS, AVATAR)).toBe(frame)
})
