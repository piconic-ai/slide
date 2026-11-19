import { expect, test } from 'vitest'
import { HomeDropFrame } from './home-drop-frame'
import { HomeFollowingFrame, HomeOwnSlidesFrame } from './home-signed-in-frames'
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

test('Given the top page, When the frames of a signed-in visitor are drawn, Then both are hidden and empty, with no heading to show before anything is known', () => {
  const frames = [<HomeOwnSlidesFrame />, <HomeFollowingFrame />].map(String)
  expect(frames[0]).toMatch(
    /^<section data-home-frame="own-slides" hidden(="")?><\/section>$/,
  )
  expect(frames[1]).toMatch(
    /^<section data-home-frame="following" hidden(="")?><\/section>$/,
  )
})
