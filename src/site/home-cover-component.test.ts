import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToTest } from '@barefootjs/test'
import { expect, test } from 'vitest'

test('F03-AC10, F03-AC42: Given a recent deck card, When compiled, Then its viewer link contains both the name face and the decorative cover image', () => {
  const path = resolve(import.meta.dirname, '../../components/RecentDecks.tsx')
  const tree = renderToTest(readFileSync(path, 'utf8'), path)
  expect(tree.errors).toEqual([])

  const link = tree
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
  expect(tree.findAll({ tag: 'iframe' })).toHaveLength(0)
}, 15_000)
