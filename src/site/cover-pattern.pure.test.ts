import { expect, test } from 'vitest'
import {
  colorOfNumber,
  COMMUNITY_COLORS,
  COVER_SQUARES,
  coverOf,
  coverPattern,
  coverShades,
} from './cover-pattern'

test('F29-AC21: Given event numbers, When their colors are picked, Then each is one of the five, the same for the same number, and all five appear', () => {
  const picked = [1, 2, 3, 4, 5, 6, 410635, 0].map(colorOfNumber)
  for (const color of picked) expect(COMMUNITY_COLORS).toContain(color)
  expect(colorOfNumber(7)).toBe(colorOfNumber(7))
  expect(colorOfNumber(7)).toBe(colorOfNumber(12))
  expect(new Set([1, 2, 3, 4, 5].map(colorOfNumber)).size).toBe(5)
})

test('F29-AC21: Given a seed, When the shades are drawn twice, Then they are the same 32 shades of three, and another seed draws others', () => {
  const shades = coverShades(42)
  expect(shades).toEqual(coverShades(42))
  expect(shades).toHaveLength(COVER_SQUARES)
  for (const shade of shades) expect([0, 1, 2]).toContain(shade)
  expect(coverShades(43)).not.toEqual(shades)
  expect(new Set(coverShades(1)).size).toBeGreaterThan(1)
})

test('F29-AC21: Given a label with HTML, When the pattern is drawn, Then it is one image with the label escaped and squares hidden from readers', async () => {
  const pattern = String(
    await coverPattern({
      color: 'navy',
      seed: 1,
      label: '<b>x</b> のカバー画像',
    }),
  )
  expect(pattern).toContain('role="img"')
  expect(pattern).toContain('aria-label="&lt;b&gt;x&lt;/b&gt; のカバー画像"')
  expect(pattern.match(/<span/g)).toHaveLength(COVER_SQUARES)
})

test('F30-AC23, F29-AC21: Given a cover of each kind, When it is drawn, Then the pattern is the named pattern and the uploaded one is an image named the same, sent without a referrer', async () => {
  const label = 'Kanagawa.pm のカバー画像'
  const pattern = String(
    await coverOf({ kind: 'pattern', color: 'red', seed: 7 }, label),
  )
  expect(pattern).toBe(
    String(await coverPattern({ color: 'red', seed: 7, label })),
  )
  const image = String(
    await coverOf(
      { kind: 'image', url: '/communities/7/cover?v=1&x=<y>' },
      label,
    ),
  )
  expect(image).toMatch(/^<img\s/)
  expect(image).toContain('class="cover-image"')
  expect(image).toContain('src="/communities/7/cover?v=1&amp;x=&lt;y&gt;"')
  expect(image).toContain(`alt="${label}"`)
  expect(image).toContain('referrerpolicy="no-referrer"')
})
