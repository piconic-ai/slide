import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToTest } from '@barefootjs/test'
import { expect, test } from 'vitest'

const path = resolve(
  import.meta.dirname,
  '../../components/HomeCommunities.tsx',
)
const tree = renderToTest(readFileSync(path, 'utf8'), path)

test('F03-AC160: Given the list of the followed communities tab, When compiled, Then it has no heading or "see all" of its own, and its tab labels the grid of placeholders and the grid of cards', () => {
  expect(tree.errors).toEqual([])
  expect(tree.findAll({ tag: 'h2' })).toEqual([])
  const grids = tree.findAll({ tag: 'ul' })
  expect(grids.map((grid) => grid.aria.labelledby)).toEqual([
    'FOLLOWED_TAB',
    'FOLLOWED_TAB',
  ])
  const [loading] = grids
  expect(loading?.classes).toContain('home-loading')
  expect(loading?.aria.busy).toBe('true')
})

test('F03-AC169, F03-AC170: Given the room the tab holds, When compiled, Then cards that did not come keep their place hidden, and a note for no slide or a failure stands over the room with buttons to ask again or see recent communities', () => {
  const spare = tree
    .findAll({ tag: 'li' })
    .find((node) => node.classes.includes('home-spare'))
  expect(spare?.aria.hidden).toBe('true')
  const room = tree
    .findAll({ tag: 'div' })
    .find((node) => node.classes.includes('home-room'))
  const statuses = room?.findAll({ role: 'status' }) ?? []
  // "Loading", the note over the room, and the prompt to sign in.
  expect(statuses).toHaveLength(3)
  const note = statuses.find(
    (node) =>
      node.classes.includes('home-room-note') &&
      !node.classes.includes('home-prompt'),
  )
  const buttons = note?.findAll({ tag: 'button' }) ?? []
  expect(buttons).toHaveLength(2)
  for (const button of buttons)
    expect(button.classes).toContain('button-secondary')
})

test('F03-AC168: Given the followed communities tab for a visitor who is not signed in, When compiled, Then its note says what following does, links to signing in and offers recent communities', () => {
  const prompt = tree
    .findAll({ role: 'status' })
    .find((node) => node.classes.includes('home-prompt'))
  expect(prompt?.findAll({ tag: 'p' })).toHaveLength(2)
  expect(prompt?.find({ tag: 'a' })?.props.href).toBe('HOME_SIGN_IN_PATH')
  expect(prompt?.find({ tag: 'button' })?.events).toContain('click')
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
