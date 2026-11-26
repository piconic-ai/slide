import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToTest } from '@barefootjs/test'
import { expect, test } from 'vitest'

const path = resolve(import.meta.dirname, '../../components/HomeTabs.tsx')
const tree = renderToTest(readFileSync(path, 'utf8'), path)

test('F03-AC160: Given the tabs of the top page, When compiled, Then one tablist holds buttons with the tab role, each naming the panel it controls, chosen by a click, and the list answers keys', () => {
  expect(tree.errors).toEqual([])
  const list = tree.find({ role: 'tablist' })
  expect(list?.aria.label).toBeDefined()
  expect(list?.events).toContain('keydown')
  const tab = tree.find({ role: 'tab' })
  expect(tab?.tag).toBe('button')
  expect(tab?.props.type).toBe('button')
  expect(tab?.aria.controls).toBeDefined()
  expect(tab?.aria.selected).toBeDefined()
  expect(tab?.events).toContain('click')
})

test('F03-AC158: Given the tabs of the top page, When compiled, Then four panels follow the tablist, each labelled by its tab and hidden unless its tab is chosen', () => {
  const panels = tree.findAll({ role: 'tabpanel' })
  expect(panels.map((panel) => panel.aria.labelledby)).toEqual([
    "homeTabId('recent')",
    "homeTabId('communities')",
    "homeTabId('following')",
    "homeTabId('followed-communities')",
  ])
  for (const panel of panels) expect(panel.props.hidden).toBeDefined()
})
