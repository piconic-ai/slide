import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToTest } from '@barefootjs/test'
import { describe, expect, test } from 'vitest'

describe.each([
  { component: 'RecentDecks', headingId: 'recent' },
  { component: 'HomeFollowing', headingId: 'following-new' },
])('$component', ({ component, headingId }) => {
  const path = resolve(
    import.meta.dirname,
    '../../components',
    component + '.tsx',
  )
  const tree = renderToTest(readFileSync(path, 'utf8'), path)
  const lists = tree.findAll({ tag: 'ul' })
  const loading = lists.find((list) => list.aria.busy === 'true')
  const settled = lists.find((list) => list.aria.busy === undefined)

  test('Given the list section, When compiled, Then one heading labels both grids and the loading placeholders have no links', () => {
    expect(tree.errors).toEqual([])
    const section = tree.find({ tag: 'section' })
    const headings = section?.children.filter((node) => node.tag === 'h2')
    expect(headings?.map((node) => node.props.id)).toEqual([headingId])
    expect(lists.map((list) => list.aria.labelledby)).toEqual([
      headingId,
      headingId,
    ])
    expect(loading?.findAll({ tag: 'a' })).toEqual([])
  })

  test('Given a slot in the settled grid, When compiled, Then the card links to the deck and author while the spare is hidden and has no links', () => {
    const cards = settled?.findAll({ tag: 'li' }) ?? []
    expect(cards).toHaveLength(2)
    const card = cards.find((item) => item.aria.hidden === undefined)
    const spare = cards.find((item) => item.aria.hidden === 'true')
    expect(card?.findAll({ tag: 'a' })).toHaveLength(2)
    expect(spare?.findAll({ tag: 'a' })).toEqual([])
  })

  test('Given the loading announcement and the result message, When compiled, Then each has a status role and the result can offer a retry button', () => {
    const statuses = tree.findAll({ role: 'status' })
    expect(statuses).toHaveLength(2)
    const loadingStatus = statuses.find((node) =>
      node.classes.includes('visually-hidden'),
    )
    expect(loadingStatus?.findAll({ tag: 'button' })).toEqual([])
    const note = statuses.find((node) =>
      node.classes.includes('home-room-note'),
    )
    expect(note?.findAll({ tag: 'p' })).toHaveLength(1)
    expect(note?.findAll({ tag: 'button' })).toHaveLength(1)
    const retry = note?.find({ tag: 'button' })
    expect(retry?.props.type).toBe('button')
    expect(retry?.events).toContain('click')
  })
})
