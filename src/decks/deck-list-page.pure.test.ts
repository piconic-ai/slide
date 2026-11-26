import { expect, test } from 'vitest'
import { deckListBody, deckViewHref } from './deck-list-page'
import type { OwnDeck } from './own-decks'

const deck = (over: Partial<OwnDeck> = {}): OwnDeck => ({
  slug: 'talk',
  isPublic: true,
  shown: { deploymentId: 'd1', title: 'Good talk', coverPath: null },
  updatedAt: 100,
  ...over,
})

const rowOf = (decks: OwnDeck[], handle: string | null) =>
  String(deckListBody(decks, 'ja', null, handle))

test('F03-AC38: Given a public slide, When its row is drawn, Then the cover and the name open its viewer', () => {
  const row = rowOf([deck()], 'owner')
  expect(row.match(/href="\/@owner\/talk"/g)).toHaveLength(2)
  expect(row).toMatch(/class="deck-row-cover"\s+href="\/@owner\/talk"/)
  expect(row).toMatch(/<a href="\/@owner\/talk">Good talk<\/a>/)
})

test('F03-AC37: Given a slide, When its row is drawn, Then it has “edit” to the editing page, and no “manage”', () => {
  const row = rowOf([deck()], 'owner')
  expect(row).toMatch(
    /class="deck-row-edit"\s+href="\/my\/slides\/talk"\s+aria-label="Good talk を編集する"\s*>編集する<\/a/,
  )
  expect(row).not.toContain('管理する')
})

test.each([
  ['a slide not yet public', deck({ isPublic: false }), 'owner'],
  ['an author without a handle', deck(), null],
])(
  'F03-AC38: Given %s, When its row is drawn, Then the cover and name open the viewer, or the editing page without a handle',
  (_name, one, handle) => {
    expect(deckViewHref(one, handle)).toBe(
      handle === null ? '/my/slides/talk' : '/@owner/talk',
    )
  },
)

test('F03-AC36: Given the list in English, When it is drawn, Then the title is Your slides and the row says Edit', () => {
  const html = String(deckListBody([deck()], 'en', null, 'owner'))
  expect(html).toContain('<h1>Your slides</h1>')
  expect(html).toContain('>Edit</a')
  expect(html).not.toContain('Manage')
})
