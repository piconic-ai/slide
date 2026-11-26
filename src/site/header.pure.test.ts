import { expect, test } from 'vitest'
import { siteHeader } from './header'

test.each(['ja', 'en'] as const)(
  'Given the %s header, When rendered, Then the brand links to the top, is named with the alpha mark, and draws the wordmark',
  async (lang) => {
    const page = String(await siteHeader(lang))
    expect(page).toMatch(
      /<a class="brand" href="\/" aria-label="slide.community α"\s*>/,
    )
    expect(page).toContain('<svg class="wordmark"')
    // The alpha is drawn in the community red, like the dot.
    expect(page.match(/fill="var\(--community-red/g)).toHaveLength(2)
  },
)

test('Given a header without an account area, When rendered, Then it still draws the same brand', async () => {
  const page = String(await siteHeader('en', 'none'))
  expect(page).toContain('aria-label="slide.community α"')
  expect(page).not.toContain('data-account')
})
