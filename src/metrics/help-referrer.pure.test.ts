import { expect, test } from 'vitest'
import { helpArticleOfReferrer } from './help-referrer'

const ORIGIN = 'https://slide.example'

test.each([
  ['https://slide.example/help/start/first-slide', 'start/first-slide'],
  ['https://slide.example/help/start/first-slide/', 'start/first-slide'],
  [
    'https://slide.example/help/start/first-slide?q=a%40b.example#top',
    'start/first-slide',
  ],
])(
  'F40-AC13: Given the contact page opened from %s, When the article is read, Then it is %s',
  (header, article) => {
    expect(helpArticleOfReferrer(header, ORIGIN)).toBe(article)
  },
)

test.each([
  undefined,
  null,
  '',
  'nonsense',
  'https://slide.example/help',
  'https://slide.example/help/start',
  'https://slide.example/help/start/a/b',
  'https://slide.example/help/Start/First',
  'https://slide.example/other/start/first',
  'https://other.example/help/start/first-slide',
  'https://slide.example.evil.test/help/start/first-slide',
  'http://slide.example/help/start/first-slide',
])(
  'F40-AC13: Given the referrer %s, When the article is read, Then it is no help article of the service',
  (header) => {
    expect(helpArticleOfReferrer(header, ORIGIN)).toBeNull()
  },
)
