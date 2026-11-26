import { expect, test } from 'vitest'
import { viewerStyle } from '../share/viewer-style'
import { pageStyle } from './page-style'

/** Each rule of a style sheet: its selectors and its declarations. */
const rulesOf = (css: string) =>
  // Comments go first, so none is read as a selector.
  [
    ...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ].map(([, selectors, body]) => ({
    selectors: selectors!.trim(),
    body: body!,
  }))

const sheets = [String(pageStyle), String(viewerStyle)]

test('Given the dialogs of the login prompt and the link check, When their panels are styled, Then they are bordered and carry no shadow (DESIGN.md: panels carry none)', () => {
  const panels = rulesOf(String(pageStyle)).filter(({ selectors }) =>
    selectors
      .split(',')
      .map((selector) => selector.trim())
      .some((selector) =>
        ['.login-prompt-panel', '.link-check-panel'].includes(selector),
      ),
  )
  expect(panels.length).toBeGreaterThan(0)
  for (const { body } of panels) {
    expect(body).toContain('border: 1px solid var(--border)')
    expect(body).not.toContain('box-shadow')
  }
})

test('Given the styles of the pages and the viewer, When their shadows are read, Then only menus carry one, and the one other use is the cover’s inset 1px edge line (DESIGN.md: shadows are for menus only)', () => {
  const shadowed = sheets
    .flatMap(rulesOf)
    .filter(({ body }) => /box-shadow\s*:/.test(body))
  expect(shadowed.length).toBeGreaterThan(0)
  for (const { selectors, body } of shadowed) {
    for (const selector of selectors.split(',')) {
      if (/^\s*\.deck-cover::after\s*$/.test(selector)) {
        // A line drawn with an inset shadow, not elevation.
        expect(body).toMatch(
          /box-shadow:\s*(inset 0 0 0 1px rgb\(0 0 0 \/ 0\.08\)|none);/,
        )
      } else {
        expect(selector).toMatch(/menu/)
        expect(body).toMatch(/box-shadow:\s*var\(--shadow-menu\);/)
      }
    }
  }
})
