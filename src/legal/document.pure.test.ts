import { describe, expect, test } from 'vitest'
import {
  bodyStrings,
  historyStrings,
  isDraft,
  isEffectiveDate,
  leftoverMarks,
  splitLinks,
  textStrings,
  unfinishedReasons,
} from './document'
import { LEGAL_TEXT_KINDS, LEGAL_TEXTS } from './documents'
import { sampleText, sampleTransmission } from './test-texts'

describe('isEffectiveDate', () => {
  test.each([
    '2026-12-01',
    '2026年12月1日',
    '2026年12月01日',
    ' 2028-02-29 ',
    '2026年1月31日',
  ])('Given %j, When judged, Then it is a date', (value) => {
    expect(isEffectiveDate(value)).toBe(true)
  })

  test.each([
    '',
    ' ',
    '(施行日)',
    '（施行日）',
    '施行日',
    '未定',
    '2026-02-30',
    '2027-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-12-00',
    '2026年2月30日',
    '2026/12/01',
    '2026-12-1',
    '２０２６-12-01',
    '2026-12-01 制定',
    '令和 8 年 12 月 1 日',
  ])('Given %j, When judged, Then it is not a date', (value) => {
    expect(isEffectiveDate(value)).toBe(false)
  })
})

describe('isDraft', () => {
  test('F34-AC7: Given a text whose date is the blank, When judged, Then it is a draft', () => {
    expect(isDraft(sampleText('(施行日)'))).toBe(true)
    expect(isDraft(sampleTransmission('(施行日)'))).toBe(true)
  })

  test('F34-AC10: Given a text with a date, When judged, Then it is not a draft', () => {
    expect(isDraft(sampleText('2026-12-01'))).toBe(false)
    expect(isDraft(sampleTransmission('2026年12月1日'))).toBe(false)
  })

  test('Given a text with no history or a date that is not a date, When judged, Then it stays a draft', () => {
    expect(isDraft(sampleText('', { history: [] }))).toBe(true)
    expect(isDraft(sampleText('未定'))).toBe(true)
    expect(isDraft(sampleText('2026-02-30'))).toBe(true)
  })

  test('Given a history of several lines, When judged, Then only the enactment decides', () => {
    const later = { date: '2027-01-01', summary: '第 1 条を改める' }
    expect(
      isDraft(
        sampleText('(施行日)', {
          history: [{ date: '(施行日)', summary: '制定' }, later],
        }),
      ),
    ).toBe(true)
    expect(
      isDraft(
        sampleText('2026-12-01', {
          history: [
            { date: '2026-12-01', summary: '制定' },
            { date: '(施行日)', summary: '改正' },
          ],
        }),
      ),
    ).toBe(false)
  })
})

describe('D-22: a text with a date may not keep a blank', () => {
  const dated = '2026-12-01'

  test.each(['(日数)', '(年数)', '(施行日)', '（日数）', '( 日数 )'])(
    'F34-AC13: Given a text with a date and the mark %s, When checked, Then it is reported',
    (mark) => {
      const text = sampleText(dated, {
        preamble: [`履歴情報は ${mark} 残す。`],
      })
      expect(isDraft(text)).toBe(false)
      expect(unfinishedReasons(text)).not.toEqual([])
    },
  )

  test('F34-AC13: Given a mark in a later line of the history, When checked, Then it is reported', () => {
    const text = sampleText(dated, {
      history: [
        { date: dated, summary: '制定' },
        { date: '(施行日)', summary: '改正' },
      ],
    })
    expect(leftoverMarks(text)).toEqual(['(施行日)'])
    expect(unfinishedReasons(text)).toHaveLength(1)
  })

  test('F34-AC13: Given a mark in a clause, an item or the table, When checked, Then it is reported', () => {
    const inItem = sampleText(dated, {
      articles: [
        {
          number: 1,
          title: 'x',
          body: {
            kind: 'clauses',
            clauses: [{ text: 'a', items: ['b (年数) c'] }],
          },
        },
      ],
    })
    expect(leftoverMarks(inItem)).toEqual(['(年数)'])
    const inTable = {
      ...sampleTransmission(dated),
      description: '送る前に (日数) 置く',
    }
    expect(leftoverMarks(inTable)).toEqual(['(日数)'])
  })

  test('F34-AC14: Given a text with a date and no blank, When checked, Then nothing is reported', () => {
    expect(unfinishedReasons(sampleText(dated))).toEqual([])
    expect(unfinishedReasons(sampleTransmission(dated))).toEqual([])
  })

  test('Given a draft that still has blanks, When checked, Then it is not reported: it is shown as a draft', () => {
    const draft = sampleText('(施行日)', { preamble: ['(日数) と (年数)'] })
    expect(leftoverMarks(draft)).toEqual(['(日数)', '(年数)', '(施行日)'])
    expect(unfinishedReasons(draft)).toEqual([])
  })

  test('Given brackets in the text that are not blanks, When checked, Then they are not reported', () => {
    const text = sampleText(dated, {
      preamble: ['(以下「本規約」)と(日)と(施行)'],
    })
    expect(leftoverMarks(text)).toEqual([])
  })

  test.each(LEGAL_TEXT_KINDS)(
    'F34-AC13: Given the carried %s text, When checked, Then it has no date with a blank left in it',
    (kind) => {
      expect(unfinishedReasons(LEGAL_TEXTS[kind])).toEqual([])
    },
  )
})

describe('the strings of a text', () => {
  test('Given an article text, When listed, Then the body is in reading order and the history is last', () => {
    const text = sampleText('(施行日)')
    expect(bodyStrings(text).slice(0, 3)).toEqual([
      '見本',
      '前文 <b>と</b> & 引用',
      '第 1 条(適用)',
    ])
    expect(historyStrings(text)).toEqual(['(施行日): 制定'])
    expect(textStrings(text).slice(-2)).toEqual(['附則', '(施行日): 制定'])
  })
})

describe('splitLinks', () => {
  const link = { phrase: '「外部への送信」', href: '/privacy/external' }

  test('Given a sentence with the phrase, When split, Then the phrase is a link and the rest is text', () => {
    expect(splitLinks('上の「外部への送信」のページ', [link])).toEqual([
      { kind: 'text', text: '上の' },
      { kind: 'link', text: '「外部への送信」', href: '/privacy/external' },
      { kind: 'text', text: 'のページ' },
    ])
  })

  test('Given a sentence without the phrase, When split, Then it is one text', () => {
    expect(splitLinks('外部への送信', [link])).toEqual([
      { kind: 'text', text: '外部への送信' },
    ])
  })

  test('Given the phrase twice, When split, Then only the first is a link', () => {
    const segments = splitLinks('「外部への送信」と「外部への送信」', [link])
    expect(segments.filter((segment) => segment.kind === 'link')).toHaveLength(
      1,
    )
    expect(segments.map((segment) => segment.text).join('')).toBe(
      '「外部への送信」と「外部への送信」',
    )
  })

  test('Given an empty sentence, no links or an empty phrase, When split, Then nothing breaks', () => {
    expect(splitLinks('', [link])).toEqual([])
    expect(splitLinks('文', [])).toEqual([{ kind: 'text', text: '文' }])
    expect(splitLinks('文', [{ phrase: '', href: '/x' }])).toEqual([
      { kind: 'text', text: '文' },
    ])
  })

  test('Given overlapping phrases, When split, Then the text is kept whole and no link is cut', () => {
    const sentence = 'あいうえお'
    const segments = splitLinks(sentence, [
      { phrase: 'あいう', href: '/a' },
      { phrase: 'いうえ', href: '/b' },
    ])
    expect(segments.map((segment) => segment.text).join('')).toBe(sentence)
    expect(segments.filter((segment) => segment.kind === 'link')).toHaveLength(
      1,
    )
  })

  test('Given two phrases given out of order, When split, Then they come out in reading order', () => {
    const segments = splitLinks('甲と乙', [
      { phrase: '乙', href: '/b' },
      { phrase: '甲', href: '/a' },
    ])
    expect(segments.map((segment) => segment.text)).toEqual(['甲', 'と', '乙'])
  })
})
