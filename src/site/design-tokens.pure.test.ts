import { html } from 'hono/html'
import { expect, test } from 'vitest'
import { designTokensCss, designTokensCssRaw } from './design-tokens'

test('Given designTokensCss, When inspected, Then it declares DESIGN.md frame values and the full font stacks', () => {
  expect(designTokensCss).toContain(':root {')
  expect(designTokensCss).toContain('--background: #ffffff;')
  expect(designTokensCss).toContain('--foreground: #111111;')
  expect(designTokensCss).toContain('--primary: #111111;')
  expect(designTokensCss).toContain('--muted-foreground: #5c5c5c;')
  expect(designTokensCss).toContain('--border: #e6e6e6;')
  expect(designTokensCss).toContain('--input: #8c8c8c;')
  expect(designTokensCss).toContain('--stage: #000000;')
  expect(designTokensCss).toContain('--warning: #8a5200;')
  expect(designTokensCss).toContain('--unread: #ff3d8b;')
  expect(designTokensCss).toContain('--block-yellow: #feeba6;')
  expect(designTokensCss).toContain('--radius-xs: 2px;')
  expect(designTokensCss).toContain('--radius-full: 9999px;')
  expect(designTokensCss).toContain('--radius-block: 24px;')
  expect(designTokensCss).toContain('--space-section: 96px;')
  expect(designTokensCss).toContain('--duration-fast: 0.15s;')
  expect(designTokensCss).toContain(
    '--shadow-menu: 0 6px 20px rgb(0 0 0 / 0.12);',
  )
  expect(designTokensCss).toContain('--ink-strong: var(--foreground);')
  expect(designTokensCss).toContain('--footer-ink: var(--muted-foreground);')
  expect(designTokensCss).not.toContain('--mock-')
  expect(designTokensCss).toMatch(/--font-sans:[^;]*['"]Segoe UI['"]/)
  expect(designTokensCss).toMatch(/--font-sans:[^;]*['"]Hiragino Sans['"]/)
  expect(designTokensCss).toMatch(/--font-sans:[^;]*['"]Noto Sans JP['"]/)
  expect(designTokensCss).toContain('SFMono-Regular')
})

test('Given a style element that embeds designTokensCssRaw, When rendered to a string, Then font names keep real quotes', async () => {
  const page = String(
    await html`<style>
      ${designTokensCssRaw}
    </style>`,
  )
  expect(page).toContain('<style>')
  expect(page).not.toContain('&quot;')
  expect(page).not.toContain('&#39;')
  expect(page).toMatch(/['"]Segoe UI['"]/)
  expect(page).toMatch(/['"]Hiragino Sans['"]/)
  expect(page).toMatch(/['"]Noto Sans JP['"]/)
})

test('Given shared page chrome, When primary controls are focused, Then the outline stays ink on a light canvas', async () => {
  const { pageStyle } = await import('./page-style')
  const css = String(await pageStyle)
  expect(css).not.toMatch(
    /\.cta:focus-visible[^{]*\{[^}]*outline-color:\s*var\(--primary-foreground\)/,
  )
  expect(css).toMatch(
    /\.profile-heading button:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--ring\)/,
  )
})
