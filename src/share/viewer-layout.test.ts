import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  DEFAULT_VIEWER_LAYOUT,
  layoutForWidth,
  NARROW_SCREEN_MAX,
  parseStoredLayout,
  VIEWER_LAYOUT_KEY,
  VIEWER_LAYOUTS,
} from './viewer-layout'
import { viewerLayoutMenu } from './viewer-layout-menu'

describe('F03-AC105, F03-AC111: what the browser kept', () => {
  test.each(VIEWER_LAYOUTS)(
    'Given the kept value %s, When it is read, Then that layout shows',
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
  ])('Given %s, When it is read, Then the stack shows', (_name, stored) => {
    expect(parseStoredLayout(stored)).toBe('stack')
    expect(DEFAULT_VIEWER_LAYOUT).toBe('stack')
  })
})

describe('F03-AC113: a narrow screen', () => {
  test.each(VIEWER_LAYOUTS)(
    'Given %s is chosen, When the screen is 760px wide or narrower, Then the stack shows, and from 761px the choice shows',
    (layout) => {
      expect(NARROW_SCREEN_MAX).toBe(760)
      for (const width of [0, 320, 375, 759, 760])
        expect(layoutForWidth(layout, width)).toBe('stack')
      for (const width of [761, 1280, 3840])
        expect(layoutForWidth(layout, width)).toBe(layout)
    },
  )
})

describe('F03-AC107: the menu the server draws', () => {
  test('Given Japanese, When the menu is drawn, Then three radio items carry an icon and a name, and only the stack is checked', () => {
    const markup = String(viewerLayoutMenu('ja'))
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

  test('Given English, When the menu is drawn, Then the names are English', () => {
    const markup = String(viewerLayoutMenu('en'))
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
