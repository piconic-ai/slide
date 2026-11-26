import { expect, test } from 'vitest'
import { landingOf } from '../auth/landing'
import { newCommunityLanding } from './new-landing'

const GROUP = '/communities/new?link=https%3A%2F%2Fkanagawapm.connpass.com%2F'

test.each([
  ['/communities/new', '/communities/new'],
  [GROUP, GROUP],
  ['/communities/new?link=https://kanagawapm.connpass.com/&x=1', GROUP],
  ['/communities/new?link=javascript%3Aalert(1)', '/communities/new'],
  [
    `/communities/new?link=${encodeURIComponent(`https://a.example/${'a'.repeat(200)}`)}`,
    '/communities/new',
  ],
])(
  'F30-AC40: Given the sign-in was asked to return to %s, When it lands, Then it goes to %s, the group carried only when it is an address',
  (to, landing) => {
    expect(landingOf(to)).toBe(landing)
  },
)

test.each([
  '//evil.example/communities/new',
  'https://evil.example/communities/new',
  '/communities/new/../../slides',
  '/communities/newer',
  '/communities/new@evil.example',
])(
  'F30-AC40: Given %s, which only looks like the page, When the landing is read, Then it is not taken',
  (to) => {
    expect(newCommunityLanding(to)).toBeNull()
    expect(landingOf(to)).toBe('/slides')
  },
)

test('F30-AC62: Given the sign-in was asked to return to the communities run, When it lands, Then it goes there', () => {
  expect(landingOf('/communities/manage')).toBe('/communities/manage')
})

test.each([
  '/communities/manage/',
  '/communities/manage?x=1',
  '/communities/managed',
  '//evil.example/communities/manage',
])(
  'F30-AC62: Given %s, which only looks like the communities run, When the landing is read, Then the list of slides is taken',
  (to) => {
    expect(landingOf(to)).toBe('/slides')
  },
)
