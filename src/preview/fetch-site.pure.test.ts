import { expect, test } from 'vitest'
import { ownerSessionApplies } from './fetch-site'

test.each([
  ['the deployment’s own subresource or its frame’s move', 'same-origin'],
  ['a client without the header', undefined],
])(
  'F17-AC1: Given %s, When the session is considered, Then it applies',
  (_, site) => {
    expect(ownerSessionApplies(site)).toBe(true)
  },
)

test.each([
  ['a script, image or frame inside another deployment', 'same-site'],
  ['a request from another site, or through one by a redirect', 'cross-site'],
  ['an address typed at the top level', 'none'],
  ['an unknown value', 'elsewhere'],
  ['an empty value', ''],
])(
  'F17-AC1: Given %s, When the session is considered, Then it does not apply',
  (_, site) => {
    expect(ownerSessionApplies(site)).toBe(false)
  },
)
