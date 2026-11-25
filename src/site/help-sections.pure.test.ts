import { expect, test } from 'vitest'
import {
  HELP_SECTION_IDS,
  helpSections,
  type HelpSectionId,
} from './help-content'
import type { Lang } from './i18n'

const squash = (text: string) => text.replace(/\s+/g, '')
const JAPANESE = /[\u3040-\u30ff\u4e00-\u9fff]/

async function sectionText(lang: Lang, id: HelpSectionId) {
  const section = helpSections(lang).find((s) => s.id === id)
  if (!section) throw new Error(`no section ${id}`)
  return { title: section.title, body: squash(String(await section.body)) }
}

test('Given the help, When its sections are listed, Then the event section comes after following and before safety', () => {
  const ids = [...HELP_SECTION_IDS]
  expect(ids.slice(ids.indexOf('follow'), ids.indexOf('safety') + 1)).toEqual([
    'follow',
    'events',
    'safety',
  ])
})

test.each([
  [
    'ja',
    'イベントの発表',
    [
      'イベントのページの URL を入れて「追加する」',
      '種類が「イベント」になります',
      'https://グループ名.connpass.com/event/番号/',
      'https://グループ名.doorkeeper.jp/events/番号',
      'https://luma.com/文字列',
      '一般公開中のスライドだけ',
      'イベントのページを取りに行きません',
      // How the name is decided.
      '最初に保存されたもの',
      '後から別の題名で足しても変わりません',
      'connpass のイベント 410635',
      // How to take slides out.
      '「外す」を押すか、種類を「イベント」からほかの種類に変えて',
    ],
  ],
  [
    'en',
    'Event talks',
    [
      'press “Add”',
      'get the kind Event',
      'https://group-name.connpass.com/event/number/',
      'https://group-name.doorkeeper.jp/events/number',
      'https://luma.com/name',
      'lists only public slides',
      'does not fetch the event’s page',
      'the title of the first saved related link',
      'Adding another title later does not change it',
      'connpass event 410635',
      'press “Remove” on the link, or change its kind from Event',
    ],
  ],
] as const)(
  'F29-AC26: Given the help in %s, When the section on event talks is read, Then it says that an event URL in the related links lists the slides, how the name is decided, and how to take them out',
  async (lang, title, phrases) => {
    const section = await sectionText(lang, 'events')
    expect(section.title).toBe(title)
    for (const phrase of phrases) expect(section.body).toContain(squash(phrase))
    if (lang === 'en') expect(section.body).not.toMatch(JAPANESE)
  },
)
