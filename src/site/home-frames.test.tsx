import { expect, test } from 'vitest'
import { HomeDropFrame } from './home-drop-frame'
import { japaneseOutside } from './test-japanese'

test.each([
  ['ja', 'スライドをここにドロップ', 'ファイルを選ぶ'],
  ['en', 'Drop your slides here', 'Choose a file'],
] as const)(
  'Given the top page in %s, When the place to drop slides is drawn, Then it has a real file input, a button that stays disabled until the script enables it, and loads that script',
  (lang, title, choose) => {
    const frame = String(<HomeDropFrame lang={lang} />)
    expect(frame).toContain('data-drop-zone="new"')
    expect(frame).toMatch(
      new RegExp(
        `<p class="drop-title" data-drop-title(="[a-z]*")?>${title}</p>`,
      ),
    )
    expect(frame).toMatch(
      new RegExp(
        `<button type="button" class="button-secondary" data-drop-choose(="[a-z]*")? disabled(="")?>${choose}</button>`,
      ),
    )
    expect(frame).toMatch(
      new RegExp(
        `<input type="file" data-drop-input(="[a-z]*")? accept="\\.html,\\.htm,\\.zip,text/html,application/zip" aria-label="${choose}" hidden(="")?/?>`,
      ),
    )
    expect(frame).toContain('<script type="module" src="/drop.js"></script>')
    if (lang === 'en') expect(japaneseOutside(frame)).toEqual([])
  },
)
