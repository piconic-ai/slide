import { expect, test } from 'vitest'
import { ownerSessionApplies } from './fetch-site'

test.each([
  ['the deployment’s own subresource', 'same-origin', 'no-cors', 'script'],
  ['an address the reader typed', 'none', 'navigate', 'document'],
  ['the redirect after the launch form', 'cross-site', 'navigate', 'document'],
  ['a link from another deployment', 'same-site', 'navigate', 'document'],
  ['a client without the headers', undefined, undefined, undefined],
])(
  'F17-AC1: Given %s, When the session is considered, Then it applies',
  (_, site, mode, dest) => {
    expect(ownerSessionApplies({ site, mode, dest, purpose: undefined })).toBe(
      true,
    )
  },
)

test.each([
  ['a script another deployment pulls in', 'same-site', 'no-cors', 'script'],
  ['a fetch from another deployment', 'same-site', 'cors', 'empty'],
  ['an image on another site', 'cross-site', 'no-cors', 'image'],
  ['a frame inside another deployment', 'same-site', 'navigate', 'iframe'],
  ['a frame on another site', 'cross-site', 'navigate', 'iframe'],
  ['a navigation that is not a document', 'same-site', 'navigate', 'embed'],
  ['a document that is not a navigation', 'same-site', 'cors', 'document'],
  ['an unknown site value', 'elsewhere', 'navigate', 'iframe'],
  ['an empty site value', '', 'no-cors', 'script'],
])(
  'F17-AC1: Given %s, When the session is considered, Then it does not apply',
  (_, site, mode, dest) => {
    expect(ownerSessionApplies({ site, mode, dest, purpose: undefined })).toBe(
      false,
    )
  },
)

test('F17-AC1: Given a page another deployment asks the browser to load ahead of time, When the session is considered, Then it does not apply', () => {
  expect(
    ownerSessionApplies({
      site: 'same-site',
      mode: 'navigate',
      dest: 'document',
      purpose: 'prefetch;prerender',
    }),
  ).toBe(false)
})

test('F17-AC1: Given the deployment’s own page loaded ahead of time, When the session is considered, Then it applies', () => {
  expect(
    ownerSessionApplies({
      site: 'same-origin',
      mode: 'navigate',
      dest: 'document',
      purpose: 'prefetch',
    }),
  ).toBe(true)
})
