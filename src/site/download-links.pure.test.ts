import { expect, test } from 'vitest'
import { downloadFrame } from '../decks/download-frame'
import { downloadLinks } from './download-links'
import { settingsExportFrame } from './settings-export-frame'

const url = new URL('https://slide.example/settings')
const zip = { label: 'Published version (zip)', href: '/my/slides/talk/zip' }
const info = { label: 'Slide information (JSON)', href: '/my/slides/talk/info' }

test('Given no links, When the list is drawn, Then nothing is drawn', () => {
  expect(downloadLinks([])).toBe('')
})

test('Given links, When drawn, Then each is a download link in a list, in order', async () => {
  const out = String(await downloadLinks([zip, info]))
  expect(out.match(/<a /g)).toHaveLength(2)
  expect(out.match(/ download>/g)).toHaveLength(2)
  expect(out.indexOf(zip.href)).toBeLessThan(out.indexOf(info.href))
  expect(out).toContain('class="download-links"')
})

test('Given a label and a path with markup, When drawn, Then they are escaped', async () => {
  const out = String(
    await downloadLinks([
      { label: '<img src=x onerror=1>', href: '"><script>1</script>' },
    ]),
  )
  expect(out).not.toContain('<img')
  expect(out).not.toContain('<script>')
})

test.each(['ja', 'en'] as const)(
  'Given no links, When the places are drawn in %s, Then neither shows anything',
  (lang) => {
    expect(downloadFrame([], lang)).toBe('')
    expect(settingsExportFrame(null, lang, url)).toBe('')
  },
)

test.each([
  ['ja', 'ダウンロード', 'データを書き出す'],
  ['en', 'Download', 'Export your data'],
] as const)(
  'Given links, When the places are drawn in %s, Then each has its heading and the links',
  async (lang, deckHeading, settingsHeading) => {
    const deck = String(await downloadFrame([zip], lang))
    expect(deck).toContain(`<h2>${deckHeading}</h2>`)
    expect(deck).toContain(zip.href)
    const settings = String(
      await settingsExportFrame(
        { account: [zip, info], slides: [], page: 1, lastPage: 1 },
        lang,
        url,
      ),
    )
    expect(settings).toContain(`<h2>${settingsHeading}</h2>`)
    expect(settings).toContain(info.href)
  },
)
