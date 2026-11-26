import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToTest } from '@barefootjs/test'
import { expect, test } from 'vitest'

const path = resolve(import.meta.dirname, '../../components/NewCommunities.tsx')
const tree = renderToTest(readFileSync(path, 'utf8'), path)

test('F30-AC48: Given the section of new communities, When compiled, Then one heading labels the grid of placeholders and the grid of cards, and "see all" beside it leads to /communities', () => {
  expect(tree.errors).toEqual([])
  const heading = tree.find({ tag: 'section' })?.find({ tag: 'h2' })
  expect(heading?.props.id).toBe('new-communities')
  const grids = tree.findAll({ tag: 'ul' })
  expect(grids.map((grid) => grid.aria.labelledby)).toEqual([
    'new-communities',
    'new-communities',
  ])
  expect(grids[0]?.classes).toContain('home-loading')
  expect(grids[0]?.aria.busy).toBe('true')
  const head = tree
    .findAll({ tag: 'div' })
    .find((node) => node.classes.includes('home-section-head'))
  // The IR keeps the bound name; the route test opens the path it holds.
  expect(head?.find({ tag: 'a' })?.props.href).toBe('NEW_COMMUNITIES_PATH')
})

test('F30-AC46, F30-AC48: Given a card of the section, When compiled, Then it is one link to the community, with its cover and logo hidden from screen readers and no button', () => {
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

test('F30-AC49: Given the room the section holds, When compiled, Then cards that did not come keep their place hidden, and a message for none or a failure stands over the room with a button to ask again', () => {
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
