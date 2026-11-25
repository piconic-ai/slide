import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToTest } from '@barefootjs/test'
import { expect, test } from 'vitest'

const path = resolve(
  import.meta.dirname,
  '../../components/HomeCommunities.tsx',
)
const tree = renderToTest(readFileSync(path, 'utf8'), path)

test('F31-AC3, F31-AC16: Given the section of followed communities, When compiled, Then one heading labels the grid of placeholders and the grid of cards that replaces it', () => {
  expect(tree.errors).toEqual([])
  const section = tree.find({ tag: 'section' })
  const heading = section?.find({ tag: 'h2' })
  expect(heading?.props.id).toBe('communities-new')
  const grids = tree.findAll({ tag: 'ul' })
  expect(grids.map((grid) => grid.aria.labelledby)).toEqual([
    'communities-new',
    'communities-new',
  ])
  const [loading] = grids
  expect(loading?.classes).toContain('home-loading')
  expect(loading?.aria.busy).toBe('true')
})

test('F31-AC16: Given the room the section holds, When compiled, Then cards that did not come keep their place hidden, and a message for no slide or a failure stands over the room', () => {
  const spare = tree
    .findAll({ tag: 'li' })
    .find((node) => node.classes.includes('home-spare'))
  expect(spare?.aria.hidden).toBe('true')
  const room = tree
    .findAll({ tag: 'div' })
    .find((node) => node.classes.includes('home-room'))
  const statuses = room?.findAll({ role: 'status' }) ?? []
  // "Loading" while the list is on its way, then the note over the room.
  expect(statuses).toHaveLength(2)
  const note = statuses.find((node) => node.classes.includes('home-room-note'))
  expect(note?.find({ tag: 'button' })?.classes).toContain('button-secondary')
})

test('F31-AC5: Given the heading of the section, When compiled, Then "see all" beside it leads to the whole list', () => {
  const head = tree
    .findAll({ tag: 'div' })
    .find((node) => node.classes.includes('home-section-head'))
  const link = head?.find({ tag: 'a' })
  // The IR keeps the bound name; the route test opens the path it holds.
  expect(link?.props.href).toBe('FOLLOWED_COMMUNITY_TALKS_PATH')
})

test('F31-AC4: Given a card of the section, When compiled, Then it links the deck, the author and the community, after a hidden mark of its color', () => {
  const card = tree
    .findAll({ tag: 'li' })
    .find((node) => node.findAll({ tag: 'a' }).length > 0)
  expect(card?.findAll({ tag: 'a' })).toHaveLength(3)
  const community = card
    ?.findAll({ tag: 'span' })
    .find((node) => node.classes.includes('card-community'))
  const mark = community
    ?.findAll({ tag: 'span' })
    .find((node) => node.classes.includes('community-mark'))
  expect(mark?.aria.hidden).toBe('true')
  expect(community?.findAll({ tag: 'a' })).toHaveLength(1)
})
