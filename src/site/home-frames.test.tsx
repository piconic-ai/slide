import { expect, test } from 'vitest'
import { HomeDropFrame } from './home-drop-frame'
import { japaneseOutside } from './test-japanese'

test.each([
  ['ja', 'スライドをここにドロップ', 'ファイルを選ぶ'],
  ['en', 'Drop your slides here', 'Choose a file'],
] as const)(
  'Given the top page in %s, When the place to drop slides is drawn, Then it names itself for what fills it and its button is disabled',
  (lang, title, choose) => {
    const frame = String(<HomeDropFrame lang={lang} />)
    expect(frame).toContain('data-drop-zone="new"')
    expect(frame).toContain(`<p class="drop-title">${title}</p>`)
    expect(frame).toMatch(
      new RegExp(
        `<button type="button" class="button-secondary" disabled(="")?>${choose}</button>`,
      ),
    )
    if (lang === 'en') expect(japaneseOutside(frame)).toEqual([])
  },
)
