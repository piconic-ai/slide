import { expect, test } from 'vitest'
import type { DeckSlug } from '../decks/deck-id'
import type { Handle } from '../share/handle'
import {
  EMBED_LINE_HEIGHT,
  embedCode,
  embedCodeOf,
  embedPath,
  embedSizeAt,
} from './code'

const SRC = 'https://slide.example/embed/@owner/talk'

/** The box around the frame, as the code writes it. */
const BOX = '<div style="position:relative;padding-top:calc(56.25% + 45px)">'

/** The attributes of the one frame the code holds, as a browser reads them. */
function attributesOf(code: string) {
  const tag =
    /^<div style="[^"<>]*"><iframe((?:\s[a-z]+(?:="[^"<>]*")?)+)><\/iframe><\/div>$/.exec(
      code,
    )
  expect(tag).not.toBeNull()
  return Object.fromEntries(
    [...(tag?.[1] ?? '').matchAll(/\s([a-z]+)(?:="([^"]*)")?/g)].map(
      ([, name, value = '']) => [
        name,
        value
          .replaceAll('&quot;', '"')
          .replaceAll('&lt;', '<')
          .replaceAll('&gt;', '>')
          .replaceAll('&amp;', '&'),
      ],
    ),
  )
}

test('F25-AC8: Given public slides, When the embed code is built, Then it is one frame with a title, loaded lazily, in a box as wide as its column and as tall as 16:9 slides plus the line under them', () => {
  const code = embedCode({ src: SRC, title: 'Good talk' })
  expect(code.match(/<iframe\b/g)).toHaveLength(1)
  expect(code.startsWith(BOX)).toBe(true)
  expect(attributesOf(code)).toEqual({
    src: SRC,
    title: 'Good talk',
    loading: 'lazy',
    // For a site that drops the style: 16:9 slides and the line.
    width: '960',
    height: '585',
    style: 'position:absolute;top:0;left:0;width:100%;height:100%;border:0',
    allowfullscreen: '',
  })
  expect(EMBED_LINE_HEIGHT).toBe(45)
})

test.each([
  ['the width the code names', 960, 585],
  ['a phone column', 390, 264],
  ['a width that is not a multiple of 16', 652, 411],
  ['one pixel', 1, 46],
])(
  'F25-AC8: Given %s, When the size of the frame is chosen, Then it is 16:9 slides in whole pixels and the line under them',
  (_, width, height) => {
    expect(embedSizeAt(width)).toEqual({ width, height })
  },
)

test.each([
  ['double quotes', 'A "quoted" talk'],
  ['markup', '</iframe><script>alert(1)</script><iframe src="x">'],
  ['an ampersand and an entity', 'Q&A &quot;live&quot; &lt;3'],
  ['single quotes and a backtick', "it's `fine`"],
  ['an emoji and Japanese', 'スライド 🎉'],
  ['a lone surrogate', 'broken \ud83c title'],
  ['nothing', ''],
])(
  'F25-AC8: Given a title with %s, When the embed code is built, Then the code is still one frame and its title reads back whole',
  (_, title) => {
    const code = embedCode({ src: SRC, title })
    expect(code.match(/<[a-z/]/g)).toEqual(['<d', '<i', '</', '</'])
    const attributes = attributesOf(code)
    expect(attributes.title).toBe(title)
    expect(attributes.src).toBe(SRC)
  },
)

test('F25-AC8: Given a title with line breaks and control characters, When the embed code is built, Then the code stays on one line', () => {
  const code = embedCode({
    src: SRC,
    title: 'one\r\ntwo\tthree\u0000four\u007f',
  })
  expect(code).not.toMatch(/[\u0000-\u001f\u007f]/)
  expect(attributesOf(code).title).toBe('one two three four ')
})

test('F25-AC10: Given slides and a page of them, When the path to frame is built, Then it is the share path under /embed', () => {
  const handle = 'owner' as Handle
  const slug = 'talk' as DeckSlug
  expect(embedPath(handle, slug)).toBe('/embed/@owner/talk')
  expect(embedPath(handle, slug, 3)).toBe('/embed/@owner/talk/3')
})

test('F25-AC9: Given a share URL and a size, When the embed code is built for a consumer with limits, Then only the attributes for the size differ from the code an author copies', () => {
  const share = 'https://slide.example/@owner/talk'
  const copied = embedCodeOf(share, 'Good talk')
  expect(copied).toBe(embedCode({ src: SRC, title: 'Good talk' }))
  const sized = embedCodeOf(share, 'Good talk', { width: 320, height: 180 })
  expect(attributesOf(sized)).toEqual({
    ...attributesOf(copied),
    width: '320',
    height: '180',
  })
  // The size the code has by itself, given as a limit, changes nothing.
  expect(embedCodeOf(share, 'Good talk', { width: 960, height: 585 })).toBe(
    copied,
  )
})
