import { expect, test } from 'vitest'
import { coverUrl, previewImageUrl } from './cover'

const ID = '7ae11c67-633f-4f21-b2b1-80af84107428'
const base = new URL('https://content.example')
const paged = { id: ID, coverPath: null }
const ownCover = { ...paged, coverPath: 'images/og 1.png' }
const OWN_COVER_URL = `https://d-${ID}.content.example/images/og%201.png`

test('F05-AC23: Given any deck, When the image for its page 6 is chosen, Then it is the image the service takes of page 6', () => {
  expect(previewImageUrl(base, paged, 6)).toBe(`/covers/${ID}/6.jpg`)
})

test.each([
  ['names no cover', paged, `/covers/${ID}.jpg`],
  ['names its own cover', ownCover, OWN_COVER_URL],
])(
  'F05-AC6: Given a deck that %s, When the image for its URL without a page is chosen, Then it is the cover, as before',
  (_case, shared, cover) => {
    expect(previewImageUrl(base, shared, null)).toBe(cover)
    expect(previewImageUrl(base, shared, null)).toBe(
      coverUrl(base, shared.id, shared.coverPath),
    )
  },
)

test('F05-AC7: Given a deck that names its own cover, When the image for its page 6 is chosen, Then it is the image the service takes of page 6, not the cover', () => {
  expect(previewImageUrl(base, ownCover, 6)).toBe(`/covers/${ID}/6.jpg`)
})

test.each([
  [1, `/covers/${ID}/1.jpg`],
  [199, `/covers/${ID}/199.jpg`],
  [200, `/covers/${ID}/200.jpg`],
  [201, `/covers/${ID}.jpg`],
  [1000, `/covers/${ID}.jpg`],
  [9999, `/covers/${ID}.jpg`],
])(
  'F05-AC9: Given a deck, When the image for page %i is chosen, Then pages up to 200 get their own image and later ones the cover',
  (page, image) => {
    expect(previewImageUrl(base, paged, page)).toBe(image)
  },
)

test('F05-AC9: Given a deck that names its own cover, When the image for page 201 is chosen, Then it is that cover', () => {
  expect(previewImageUrl(base, ownCover, 201)).toBe(OWN_COVER_URL)
})
