import { html } from 'hono/html'
import { expect, test } from 'vitest'
import { designTokensCss, designTokensCssRaw } from './design-tokens'

test('Given designTokensCss, When inspected, Then it declares :root variables and quoted font families', () => {
  expect(designTokensCss).toContain(':root {')
  expect(designTokensCss).toContain('--background:')
  expect(designTokensCss).toContain('--font-sans:')
  expect(designTokensCss).toMatch(/['"]Segoe UI['"]/)
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
})
