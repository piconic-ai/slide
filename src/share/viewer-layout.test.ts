import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  DEFAULT_VIEWER_LAYOUT,
  defaultLayoutFor,
  NARROW_SCREEN_MAX,
  parseStoredLayout,
  resolveLayout,
  VIEWER_LAYOUT_KEY,
  VIEWER_LAYOUTS,
} from './viewer-layout'
import { viewerLayoutMenu } from './viewer-layout-menu'

describe('F03-AC127: what the browser kept', () => {
  test.each(VIEWER_LAYOUTS)(
    'Given the kept value %s, When it is read, Then that layout is the reader’s choice',
    (layout) => {
      expect(parseStoredLayout(layout)).toBe(layout)
    },
  )

  test.each([
    ['nothing kept', null],
    ['no value', undefined],
    ['an empty string', ''],
    ['an unknown name', 'sticky'],
    ['another case', 'Side'],
    ['a name with a space', ' wide'],
    ['a number', 1],
    ['an object', { layout: 'wide' }],
  ])(
    'F03-AC126: Given %s, When it is read, Then there is no choice',
    (_name, stored) => {
      expect(parseStoredLayout(stored)).toBeNull()
    },
  )
})

describe('F03-AC124, F03-AC125, F03-AC126, F03-AC127: the layout a viewer starts in', () => {
  test('Given no choice, When the slides have no article, Then the stack; with an article, side by side', () => {
    expect(DEFAULT_VIEWER_LAYOUT).toBe('stack')
    expect(defaultLayoutFor(false)).toBe('stack')
    expect(defaultLayoutFor(true)).toBe('side')
    expect(resolveLayout(null, false, 1280)).toBe('stack')
    expect(resolveLayout(null, true, 1280)).toBe('side')
  })

  test.each(['', 'sticky', 'WIDE', 5, undefined])(
    'Given the unusable value %j, When the viewer starts, Then it is the same as with no choice',
    (stored) => {
      expect(resolveLayout(stored, false, 1280)).toBe('stack')
      expect(resolveLayout(stored, true, 1280)).toBe('side')
    },
  )

  test.each(VIEWER_LAYOUTS)(
    'Given %s chosen, When the slides have or lack an article, Then the choice stands',
    (layout) => {
      expect(resolveLayout(layout, false, 1280)).toBe(layout)
      expect(resolveLayout(layout, true, 1280)).toBe(layout)
    },
  )
})

describe('F03-AC113: a narrow screen', () => {
  test.each([...VIEWER_LAYOUTS, null])(
    'Given %s is chosen, When the screen is 760px wide or narrower, Then the stack shows, and from 761px the choice shows',
    (chosen) => {
      expect(NARROW_SCREEN_MAX).toBe(760)
      for (const article of [false, true]) {
        for (const width of [0, 320, 375, 759, 760])
          expect(resolveLayout(chosen, article, width)).toBe('stack')
        for (const width of [761, 1280, 3840])
          expect(resolveLayout(chosen, article, width)).toBe(
            chosen ?? defaultLayoutFor(article),
          )
      }
    },
  )
})

describe('F03-AC107, F03-AC128: the menu the server draws', () => {
  test('Given Japanese, When the menu is drawn, Then three radio items carry an icon and a name, and only the stack is checked', () => {
    const markup = String(viewerLayoutMenu('ja', 'stack'))
    expect(markup.match(/role="menuitemradio"/g)).toHaveLength(3)
    expect(markup.match(/aria-checked="true"/g)).toHaveLength(1)
    expect(markup).toMatch(/aria-checked="true"\s+data-layout-choice="stack"/)
    for (const name of ['縦並び', '横並び', 'ワイド'])
      expect(markup).toContain(`>${name}</span>`)
    expect(markup).toContain('role="menu"')
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('aria-label="レイアウトを選ぶ(いまは縦並び)"')
    // No description under the names.
    expect(markup.match(/<span /g)).toHaveLength(6)
  })

  test('F03-AC128: Given slides that start side by side, When the menu is drawn, Then side by side is the checked item and the button’s name says so', () => {
    const markup = String(viewerLayoutMenu('ja', 'side'))
    expect(markup).toMatch(/aria-checked="true"\s+data-layout-choice="side"/)
    expect(markup.match(/aria-checked="true"/g)).toHaveLength(1)
    expect(markup).toContain('aria-label="レイアウトを選ぶ(いまは横並び)"')
  })

  test('Given English, When the menu is drawn, Then the names are English', () => {
    const markup = String(viewerLayoutMenu('en', 'stack'))
    for (const name of ['Stacked', 'Side by side', 'Wide'])
      expect(markup).toContain(`>${name}</span>`)
  })
})

describe('F03-AC110: the key and names /share.js uses', () => {
  test('Given public/share.js, When it is read, Then it keeps under the same key and knows the same layouts', () => {
    const script = readFileSync('public/share.js', 'utf8')
    expect(script).toContain(`const LAYOUT_KEY = '${VIEWER_LAYOUT_KEY}'`)
    expect(script).toContain(
      `const LAYOUTS = [${VIEWER_LAYOUTS.map((l) => `'${l}'`).join(', ')}]`,
    )
  })
})
