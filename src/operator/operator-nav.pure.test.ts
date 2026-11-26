import { expect, test } from 'vitest'
import {
  OPERATOR_PAGES,
  operatorNav,
  type OperatorPagePath,
} from './operator-nav'

test.each(OPERATOR_PAGES.map((page) => page.path))(
  'Given the page %s, When the navigation is drawn, Then only that link is the current page and all three links exist',
  async (path: OperatorPagePath) => {
    const out = String(await operatorNav(path))
    expect(out.match(/aria-current="page"/g)).toHaveLength(1)
    expect(out).toMatch(new RegExp(`href="${path}"\\s+aria-current="page"`))
    expect(out).not.toContain(`aria-current=""`)
    for (const page of OPERATOR_PAGES)
      expect(out).toContain(`href="${page.path}"`)
    expect(out).toContain('aria-label="運営の画面"')
  },
)

test('Given the pages, When listed, Then metrics and operations are among them', () => {
  expect(OPERATOR_PAGES.map((page) => page.label)).toEqual([
    '運営',
    '計測',
    '運用',
  ])
})
