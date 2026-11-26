import { expect, test } from 'vitest'
import { flipFramePath, framesSlides } from './home-flip'

test('F44-AC27: Given the viewer address of a card, When its frame is made, Then it is the compact embed page of the same slides', () => {
  expect(flipFramePath('/@owner/talk')).toBe('/embed/@owner/talk?t=compact')
  expect(flipFramePath('/@a-b/my_talk-2')).toBe(
    '/embed/@a-b/my_talk-2?t=compact',
  )
})

test.each([
  '',
  '/',
  '/@owner',
  '/@owner/',
  '/@owner/talk/3',
  '/@owner/talk?x=1',
  '/@owner/talk#2',
  '//evil.example/@owner/talk',
  'https://evil.example/@owner/talk',
  '/embed/@owner/talk',
  '/help',
  '/@/talk',
])(
  'F44-AC27: Given %j, which is not the viewer address of a deck, When its frame is made, Then there is none, so nothing is framed that the page did not list',
  (href) => {
    expect(flipFramePath(href)).toBeUndefined()
  },
)

test('F44-AC29: Given the document that came into the frame, When it is judged, Then only the embed page of slides, which holds the frame of the slides, is shown', () => {
  const holding = {
    querySelector: (selector: string) =>
      selector === 'iframe#deck' ? {} : null,
  }
  const empty = { querySelector: () => null }
  expect(framesSlides(holding)).toBe(true)
  // The 404 page, an error page of the browser, a blank document, and a
  // document that could not be read.
  expect(framesSlides(empty)).toBe(false)
  expect(framesSlides(null)).toBe(false)
  expect(framesSlides(undefined)).toBe(false)
})
