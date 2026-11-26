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

describe.each([
  'RecentDecks',
  'NewCommunities',
  'HomeFollowing',
  'HomeCommunities',
])('%s', (component) => {
  const tree = compile(component)

  test('F03-AC162: Given the list of a tab, When compiled, Then a "show more" button stands under its room, pressed by a click and not pressed twice while it loads', () => {
    expect(tree.errors).toEqual([])
    const more = tree
      .findAll({ tag: 'button' })
      .find((node) => node.classes.includes('home-more'))
    expect(more?.props.type).toBe('button')
    expect(more?.events).toContain('click')
    expect(more?.props.disabled).toBeDefined()
    const room = tree
      .findAll({ tag: 'div' })
      .find((node) => node.classes.includes('home-room'))
    expect(room?.findAll({ tag: 'button' }).includes(more!)).toBe(false)
  })

  test('F03-AC165: Given the list of a tab, When compiled, Then a failure to load more is told in its own status, with a button to ask again', () => {
    const note = tree
      .findAll({ role: 'status' })
      .find((node) => node.classes.includes('home-more-note'))
    expect(note?.findAll({ tag: 'p' })).toHaveLength(1)
    expect(note?.find({ tag: 'button' })?.events).toContain('click')
  })
})
