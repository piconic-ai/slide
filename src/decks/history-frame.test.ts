import { expect, test } from 'vitest'
import type { PanelView } from '../publication/panel'
import type { HistoryEntry } from './history'
import { historyFrame } from './history-frame'

const view: PanelView = {
  state: { publication: { kind: 'draft' }, revision: 0 },
  takedown: null,
  pointed: null,
  latest: null,
  result: null,
  delivery: true,
}
// 2026-11-19 15:30 UTC is already 20 November in Tokyo.
const RECEIVED = Date.UTC(2026, 10, 19, 15, 30) / 1000
const entry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  deploymentId: '0b5f6a0e-3a52-4c0e-9d5e-0f6f1a2b3c4d',
  source: 'browser',
  state: 'ready',
  createdAt: RECEIVED,
  readyAt: RECEIVED,
  failureReason: null,
  totalBytes: 1,
  files: { total: 1, received: 1, missing: [], missingNotShown: 0 },
  ...overrides,
})
const render = async (
  entries: readonly HistoryEntry[],
  lang: 'ja' | 'en' = 'ja',
) =>
  String(await historyFrame('talk', entries, null, view, lang)).replace(
    /\s+/g,
    ' ',
  )

test.each([
  ['browser', 'ja', '出どころ', 'ブラウザ', '2026年11月20日'],
  ['mcp', 'ja', '出どころ', 'AI エージェント', '2026年11月20日'],
  ['browser', 'en', 'Sent from', 'Browser', 'Nov 20, 2026'],
  ['mcp', 'en', 'Sent from', 'AI agent', 'Nov 20, 2026'],
] as const)(
  'F22-AC28: Given a version sent from %s, When the history renders in %s, Then its row shows where it was sent from and the day it was received',
  async (source, lang, heading, label, day) => {
    const page = await render([entry({ source })], lang)

    expect(page).toContain(`<th>${heading}</th>`)
    expect(page).toContain(`</span >${label}`)
    expect(page).toContain(
      `<time datetime="2026-11-19T15:30:00.000Z" >${day}</time >`,
    )
  },
)

test.each(['ja', 'en'] as const)(
  'F22-AC28: Given versions in every state, When the history renders in %s, Then no column or cell names a commit, a branch, a run or a repository',
  async (lang) => {
    const page = await render(
      [
        entry(),
        entry({ source: 'mcp', state: 'uploading', readyAt: null }),
        entry({ state: 'failed', failureReason: 'too_many_files' }),
        entry({ state: 'expired', readyAt: null }),
      ],
      lang,
    )

    expect(page).not.toMatch(
      /commit|コミット|refs\/|branch|ブランチ|run|実行番号|workflow|repositor|リポジトリ|GitHub/i,
    )
    expect(page.match(/<th>/g)).toHaveLength(6)
  },
)

test('F22-AC28: Given no version yet, When the history renders, Then it says so and shows no source', async () => {
  const page = await render([])

  expect(page).toContain('まだ受領した版はありません。')
  expect(page).not.toContain('ブラウザ')
  expect(page).not.toContain('AI エージェント')
})
