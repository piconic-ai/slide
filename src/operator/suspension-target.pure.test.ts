import { expect, test } from 'vitest'
import { parseSuspensionTarget } from './suspension-target'

const parse = (input: string) =>
  parseSuspensionTarget(input, 'https://slide.example')

test.each([
  ['a handle', '@kfly8'],
  ['a bare handle', 'kfly8'],
  ['surrounding whitespace', ' \n @kfly8 \t'],
  ['a profile path', '/@kfly8'],
  ['a profile URL', 'https://slide.example/@kfly8'],
  ['a profile URL with a query', 'https://slide.example/@kfly8?x=1#about'],
  ['uppercase spelling', '@KFLY8'],
  ['a trailing slash', '/@kfly8/'],
  ['an encoded profile path', '/%40KFLY8/'],
])(
  'F17-AC27: Given %s, When the suspension target is parsed, Then it names the account',
  (_, input) => {
    expect(parse(input)).toBe('kfly8')
  },
)

test.each([
  ['empty input', ''],
  ['whitespace', ' \n\t '],
  ['another origin', 'https://evil.example/@kfly8'],
  ['a different scheme', 'http://slide.example/@kfly8'],
  ['a different port', 'https://slide.example:444/@kfly8'],
  ['a misleading URL', 'https://slide.example@evil.example/@kfly8'],
  ['a malformed URL', 'https://'],
  ['a deck URL', 'https://slide.example/@kfly8/talk'],
  ['a deck path', '/@kfly8/talk'],
  ['a deck page', '@kfly8/talk/2'],
  ['a deck without an at sign', 'kfly8/talk'],
  ['a management path', '/slides/talk'],
  ['broken encoding', '/@%E0%A4%A'],
  ['HTML', '<script>alert(1)</script>'],
  ['an emoji', '@😀'],
  ['an unpaired surrogate', '@\ud800'],
  ['a very long handle', '@' + 'a'.repeat(10000)],
])(
  'F17-AC27: Given %s, When the suspension target is parsed, Then it names no account',
  (_, input) => {
    expect(parse(input)).toBeNull()
  },
)
