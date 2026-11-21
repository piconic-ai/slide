import { expect, test } from 'vitest'
import { citedCountText } from './cited-count'

test.each([
  [0, 'ja', null],
  [0, 'en', null],
  [1, 'ja', '引用された 1 件'],
  [12, 'ja', '引用された 12 件'],
  [1, 'en', 'Cited by 1'],
  [12, 'en', 'Cited by 12'],
] as const)(
  'F24-AC33, F24-AC34: Given %i citing decks and the language %s, When the card’s note is made, Then it is %j',
  (count, lang, note) => {
    expect(citedCountText(count, lang)).toBe(note)
  },
)
