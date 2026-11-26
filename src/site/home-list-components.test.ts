import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToTest } from '@barefootjs/test'
import { describe, expect, test } from 'vitest'

function compile(component: string) {
  const path = resolve(
    import.meta.dirname,
    '../../components',
    component + '.tsx',
  )
  return renderToTest(readFileSync(path, 'utf8'), path)
}

const recent = compile('RecentDecks')

describe.each([
  {
    component: 'RecentDecks',
    tab: 'RECENT_TAB',
    tree: recent,
    statuses: 2,
    noteButtons: 1,
  },
  {
    component: 'HomeFollowing',
    tab: 'FOLLOWING_TAB',
    tree: compile('HomeFollowing'),
    statuses: 3,
    noteButtons: 2,
  },
])('$component', ({ tab, tree, statuses: statusCount, noteButtons }) => {
  const lists = tree.findAll({ tag: 'ul' })
  const loading = lists.find((list) => list.aria.busy === 'true')
  const settled = lists.find((list) => list.aria.busy === undefined)

  test('F03-AC160: Given the list of a tab, When compiled, Then it has no heading of its own, its tab labels both grids, and the loading placeholders have no links', () => {
    expect(tree.errors).toEqual([])
    expect(tree.findAll({ tag: 'h2' })).toEqual([])
    expect(lists.map((list) => list.aria.labelledby)).toEqual([tab, tab])
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

  test('Given the loading announcement and the result message, When compiled, Then each has a status role and the result can offer buttons', () => {
    const statuses = tree.findAll({ role: 'status' })
    expect(statuses).toHaveLength(statusCount)
    const loadingStatus = statuses.find((node) =>
      node.classes.includes('visually-hidden'),
    )
    expect(loadingStatus?.findAll({ tag: 'button' })).toEqual([])
    const note = statuses.find(
      (node) =>
        node.classes.includes('home-room-note') &&
        !node.classes.includes('home-prompt'),
    )
    expect(note?.findAll({ tag: 'p' })).toHaveLength(1)
    const buttons = note?.findAll({ tag: 'button' }) ?? []
    expect(buttons).toHaveLength(noteButtons)
    for (const button of buttons) {
      expect(button.props.type).toBe('button')
      expect(button.events).toContain('click')
    }
  })
})

test('F03-AC167: Given the following tab for a visitor who is not signed in, When compiled, Then its note says what following does, links to signing in and offers recent slides', () => {
  const prompt = compile('HomeFollowing')
    .findAll({ role: 'status' })
    .find((node) => node.classes.includes('home-prompt'))
  expect(prompt?.findAll({ tag: 'p' })).toHaveLength(2)
  // The IR keeps the bound name; the browser test follows the link.
  expect(prompt?.find({ tag: 'a' })?.props.href).toBe('HOME_SIGN_IN_PATH')
  expect(prompt?.find({ tag: 'button' })?.events).toContain('click')
})

test('F03-AC10, F03-AC42: Given a recent deck card, When compiled, Then its viewer link contains both the name face and the decorative cover image', () => {
  const link = recent
    .findAll({ tag: 'a' })
    .find((node) => node.classes.includes('card-title'))
  const cover = link
    ?.findAll({ tag: 'span' })
    .find((node) => node.classes.includes('deck-cover'))
  const face = cover
    ?.findAll({ tag: 'span' })
    .find((node) => node.classes.includes('deck-cover-name'))
  expect(face?.aria.hidden).toBe('true')
  expect(cover?.find({ tag: 'img' })?.props).toMatchObject({
    'data-cover': true,
    alt: '',
  })
  expect(recent.findAll({ tag: 'iframe' })).toHaveLength(0)
})
