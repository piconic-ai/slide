import { expect, test } from 'vitest'
import { COMMUNITY_COLORS } from '../site/cover-pattern'
import { communityLogo, initialOf, letterContrasts, letterTone } from './logo'

test.each(COMMUNITY_COLORS)(
  'F30-AC24: Given the color %s, When its initial is drawn, Then the letter stands out 4.5:1 or more on the middle shade',
  (color) => {
    const contrast = letterContrasts(color)
    expect(contrast[letterTone(color)]).toBeGreaterThanOrEqual(4.5)
  },
)

test('F30-AC24: Given the five colors, When the tones are chosen, Then red, green and navy take white, and orange and yellow take ink', () => {
  expect(COMMUNITY_COLORS.map(letterTone)).toEqual([
    'background',
    'foreground',
    'foreground',
    'background',
    'background',
  ])
})

test.each([
  ['kanagawa.pm', 'K'],
  ['  hono', 'H'],
  ['東京', '東'],
  ['👨‍👩‍👧 family', '👨‍👩‍👧'],
  ['', ''],
])(
  'F30-AC24: Given the name %j, When its initial is taken, Then it is %j',
  (name, initial) => {
    expect(initialOf(name)).toBe(initial)
  },
)

test('F30-AC24: Given no logo, When the logo is drawn, Then the initial stands on the middle shade, hidden from screen readers beside the name', () => {
  const logo = String(
    communityLogo({ name: '<k>', color: 'red', logoUrl: null, size: 96 }),
  )
  expect(logo).toContain(
    'background: var(--community-red); color: var(--background)',
  )
  expect(logo).toContain('aria-hidden="true"')
  expect(logo).toContain('>&lt;</span')
})

test('Given an uploaded logo, When it is drawn, Then the image shows at its size', () => {
  const logo = String(
    communityLogo({
      name: 'K',
      color: 'red',
      logoUrl: '/communities/1/logo?v=2',
      size: 48,
    }),
  )
  expect(logo).toContain('src="/communities/1/logo?v=2"')
  expect(logo).toContain('width="48"')
})
