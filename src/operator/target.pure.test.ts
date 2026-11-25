import { expect, test } from 'vitest'
import { parseTakedownTarget } from './target'

const parse = (input: string) =>
  parseTakedownTarget(input, 'https://slide.example')
const talk = { handle: 'kfly8', slug: 'good-slide' }

test.each([
  ['a share URL', 'https://slide.example/@kfly8/good-slide'],
  ['a share URL of one page', 'https://slide.example/@kfly8/good-slide/6'],
  ['a share URL with a query', 'https://slide.example/@kfly8/good-slide?x=1#a'],
  ['a path', '/@kfly8/good-slide'],
  ['a path without the slash', '@kfly8/good-slide'],
  ['a path with spaces around it', '  @kfly8/good-slide \n'],
  ['an uppercase spelling', '@KFLY8/Good-Slide'],
  ['a trailing slash', '@kfly8/good-slide/'],
])(
  'Given %s, When the target is parsed, Then it names the deck',
  (_, input) => {
    expect(parse(input)).toEqual(talk)
  },
)

test.each([
  ['an empty input', ''],
  ['a profile', '@kfly8'],
  ['a path without a handle', 'kfly8/good-slide'],
  ['a share URL of another origin', 'https://evil.example/@kfly8/good-slide'],
  ['a URL that does not parse', 'https://'],
  ['a management path', '/slides/good-slide'],
  ['a path with too many segments', '@kfly8/good-slide/6/7'],
  ['a path with broken encoding', '@kfly8/%E0%A4%A'],
])('Given %s, When the target is parsed, Then it names nothing', (_, input) => {
  expect(parse(input)).toBeNull()
})
