import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToTest } from '@barefootjs/test'
import { describe, expect, test } from 'vitest'

const compile = (component: string) => {
  const path = resolve(
    import.meta.dirname,
    '../../components',
    component + '.tsx',
  )
  return renderToTest(readFileSync(path, 'utf8'), path)
}

describe('HomeTimeline', () => {
  const tree = compile('HomeTimeline')

  test('F44-AC13: Given the timeline, When compiled, Then a "show more" button is pressed by a click and not pressed twice while it loads', () => {
    expect(tree.errors).toEqual([])
    const more = tree
      .findAll({ tag: 'button' })
      .find((node) => node.classes.includes('home-more'))
    expect(more?.props.type).toBe('button')
    expect(more?.events).toContain('click')
    expect(more?.props.disabled).toBeDefined()
  })

  test('F44-AC14: Given the timeline, When compiled, Then a failure to load more is told in its own status, with a button to ask again', () => {
    const note = tree
      .findAll({ role: 'status' })
      .find((node) => node.classes.includes('home-more-note'))
    expect(note?.findAll({ tag: 'p' })).toHaveLength(1)
    expect(note?.find({ tag: 'button' })?.events).toContain('click')
  })

  test('F44-AC11: Given a slide card, When compiled, Then the link to the viewer is a link with a name and no sentence', () => {
    const open = tree
      .findAll({ tag: 'a' })
      .find((node) => node.classes.includes('icon-link'))
    expect(open?.aria.label).toBeDefined()
    expect(open?.props.href).toBeDefined()
  })

  test('F44-AC25: Given the timeline, When compiled, Then nothing but a press loads more: no scroll or intersection handler stands in it', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../../components/HomeTimeline.tsx'),
      'utf8',
    )
    expect(source).not.toMatch(/IntersectionObserver|onScroll|'scroll'/)
  })
})

describe('HomeCarousel', () => {
  const tree = compile('HomeCarousel')

  test('F44-AC21, F44-AC22: Given the carousel, When compiled, Then a card has a follow button pressed by a click, and a link that asks a visitor for the sign-in', () => {
    expect(tree.errors).toEqual([])
    const buttons = tree
      .findAll({ tag: 'button' })
      .filter((node) => node.classes.includes('button-secondary'))
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) expect(button.events).toContain('click')
    const prompts = tree
      .findAll({ tag: 'a' })
      .filter((node) => node.classes.includes('button-secondary'))
    expect(prompts.length).toBeGreaterThan(0)
  })

  test('F44-AC23: Given the carousel, When compiled, Then its arrows are buttons with names', () => {
    const arrows = tree
      .findAll({ tag: 'button' })
      .filter((node) => node.classes.includes('icon-link'))
    expect(arrows).toHaveLength(2)
    for (const arrow of arrows) {
      expect(arrow.aria.label).toBeDefined()
      expect(arrow.events).toContain('click')
    }
  })
})
