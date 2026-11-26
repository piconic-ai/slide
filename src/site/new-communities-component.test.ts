import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToTest } from '@barefootjs/test'
import { expect, test } from 'vitest'

const path = resolve(import.meta.dirname, '../../components/NewCommunities.tsx')
const tree = renderToTest(readFileSync(path, 'utf8'), path)

test('F03-AC160: Given the list of the recent communities tab, When compiled, Then it has no heading or "see all" of its own, and its tab labels the grid of placeholders and the grid of cards', () => {
  expect(tree.errors).toEqual([])
  expect(tree.findAll({ tag: 'h2' })).toEqual([])
  const grids = tree.findAll({ tag: 'ul' })
  expect(grids.map((grid) => grid.aria.labelledby)).toEqual([
    'COMMUNITIES_TAB',
    'COMMUNITIES_TAB',
  ])
  expect(grids[0]?.classes).toContain('home-loading')
  expect(grids[0]?.aria.busy).toBe('true')
})

test('F30-AC46: Given a card of the recent communities tab, When compiled, Then it is one link to the community, with its cover and logo hidden from screen readers and no button', () => {
  const card = tree
    .findAll({ tag: 'li' })
    .find((node) => node.findAll({ tag: 'a' }).length > 0)
  expect(card?.findAll({ tag: 'a' })).toHaveLength(1)
  expect(card?.findAll({ tag: 'button' })).toEqual([])
  const cover = card
    ?.findAll({ tag: 'span' })
    .find((node) => node.classes.includes('community-card-cover'))
  expect(cover?.aria.hidden).toBe('true')
  const names = card
    ?.findAll({ tag: 'span' })
    .filter((node) =>
      ['community-card-name', 'community-card-description'].some((name) =>
        node.classes.includes(name),
      ),
    )
  expect(names).toHaveLength(2)
})

test('F03-AC178: Given the room the tab holds, When compiled, Then cards that did not come keep their place hidden, and a message for none or a failure stands over the room with a button to ask again', () => {
  const spare = tree
    .findAll({ tag: 'li' })
    .find((node) => node.classes.includes('home-spare'))
  expect(spare?.aria.hidden).toBe('true')
  const room = tree
    .findAll({ tag: 'div' })
    .find((node) => node.classes.includes('home-room'))
  const statuses = room?.findAll({ role: 'status' }) ?? []
  expect(statuses).toHaveLength(2)
  const note = statuses.find((node) => node.classes.includes('home-room-note'))
  expect(note?.find({ tag: 'button' })?.classes).toContain('button-secondary')
})
