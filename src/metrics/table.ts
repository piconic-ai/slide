import type { Week } from './weeks'

/** One summed line of the daily copy, as the table reads it. */
export type DailyTotal = Readonly<{
  day: string
  event: string
  detail: string
  referrer: string
  screen: string
  events: number
  valueSum: number
}>

/**
 * One cell: a number (a count, or minutes for a duration), and for a
 * "where it sticks" row the share of the count that the row above it names,
 * both null when there is nothing to show.
 */
export type Cell = Readonly<{ value: number | null; share: number | null }>

export type Row = Readonly<{
  label: string
  unit: 'count' | 'minutes'
  cells: readonly Cell[]
}>

export type Group = Readonly<{ heading: string; rows: readonly Row[] }>

export type MetricsTable = Readonly<{
  weeks: readonly Week[]
  groups: readonly Group[]
}>

/** The most rows a group of "what came up" (hosts, words, routes) shows. */
export const TOP_ROWS = 10

type Pick = (total: DailyTotal) => boolean

const weekIndexOf = (weeks: readonly Week[], day: string): number =>
  weeks.findIndex((week) => day >= week.start && day <= week.end)

/** The sum, by week, of the totals that `pick` takes. */
function sumByWeek(
  weeks: readonly Week[],
  totals: readonly DailyTotal[],
  pick: Pick,
  field: 'events' | 'valueSum' = 'events',
): readonly number[] {
  const sums = weeks.map(() => 0)
  for (const total of totals) {
    const index = weekIndexOf(weeks, total.day)
    if (index >= 0 && pick(total))
      sums[index] = (sums[index] ?? 0) + total[field]
  }
  return sums
}

const count = (value: number): Cell => ({ value, share: null })

const countRow = (label: string, sums: readonly number[]): Row => ({
  label,
  unit: 'count',
  cells: sums.map(count),
})

/** A count and what share of `base` it is, week by week; no share at 0. */
const shareRow = (
  label: string,
  sums: readonly number[],
  base: readonly number[],
): Row => ({
  label,
  unit: 'count',
  cells: sums.map((value, index) => {
    const whole = base[index] ?? 0
    return { value, share: whole > 0 ? value / whole : null }
  }),
})

const is =
  (event: string, detail?: string): Pick =>
  (total) =>
    total.event === event && (detail === undefined || total.detail === detail)

/** Labels of the closed words, in the order the table shows them. */
const REFUSALS: readonly (readonly [string, string])[] = [
  ['too_many_files', 'ファイルの数が多すぎた'],
  ['file_too_large', '1 つのファイルが大きすぎた'],
  ['deployment_too_large', '1 つの版が大きすぎた'],
  ['author_bytes_exceeded', '作者の保存の量を超えた'],
  ['daily_starts_exceeded', '1 日に始められる数を超えた'],
  ['deck_limit', '持てるスライドの数を超えた'],
  ['not_allowed', '置ける作者ではなかった'],
]
const EXPORTS: readonly (readonly [string, string])[] = [
  ['slide', 'スライド(zip)'],
  ['article', '記事'],
  ['info', 'スライドの情報'],
  ['account', 'アカウントの情報'],
  ['picture', 'プロフィール画像'],
]

/**
 * The most counted keys of `event` over all the weeks, as rows, the one
 * `key` picks from each total. The key `''` is not a row of its own.
 */
function topRows(
  weeks: readonly Week[],
  totals: readonly DailyTotal[],
  event: string,
  key: (total: DailyTotal) => string,
  label: (key: string) => string,
): readonly Row[] {
  const sums = new Map<string, number>()
  for (const total of totals) {
    const name = key(total)
    if (
      total.event === event &&
      name !== '' &&
      weekIndexOf(weeks, total.day) >= 0
    )
      sums.set(name, (sums.get(name) ?? 0) + total.events)
  }
  return [...sums.entries()]
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, TOP_ROWS)
    .map(([name]) =>
      countRow(
        label(name),
        sumByWeek(weeks, totals, (t) => t.event === event && key(t) === name),
      ),
    )
}

/**
 * What the table is made of (D-72), from the copied days and the authors
 * counted in D1. `authors` has one count for each week, in order. Counts are
 * those made up for sampling; the authors are exact. The averages and the
 * shares are worked out from the sums, never averaged over days.
 */
export function metricsTable(
  weeks: readonly Week[],
  totals: readonly DailyTotal[],
  authors: readonly number[],
): MetricsTable {
  const sum = (pick: Pick) => sumByWeek(weeks, totals, pick)
  const sent = sum(is('login_code_sent'))
  const started = sum(is('upload_started'))
  const lag = sumByWeek(weeks, totals, is('deck_published'), 'valueSum')
  const published = sum(is('deck_published'))
  const minutes: Row = {
    label: '公開までの時間(平均)',
    unit: 'minutes',
    cells: lag.map((seconds, index) => {
      const n = published[index] ?? 0
      return { value: n > 0 ? seconds / n / 60 : null, share: null }
    }),
  }
  return {
    weeks,
    groups: [
      {
        heading: '使われているか',
        rows: [
          countRow('スライドを置いた作者の数(D1 から数えた値)', authors),
          countRow('置かれたスライド', sum(is('upload_finished'))),
          countRow('公開されたスライド', published),
          countRow('開かれたスライド(ページ)', sum(is('deck_opened', 'page'))),
          countRow(
            '開かれたスライド(埋め込み)',
            sum(is('deck_opened', 'embed')),
          ),
          countRow(
            '開かれたカード(タイムライン。閲覧には数えない)',
            sum(is('deck_opened', 'timeline')),
          ),
        ],
      },
      {
        heading: 'どこで詰まるか',
        rows: [
          countRow('ログインのコードを送った数', sent),
          shareRow(
            'コードが入れられた数(合っていた)',
            sum(is('login_code_entered', 'accepted')),
            sent,
          ),
          shareRow(
            'コードが入れられた数(合っていなかった)',
            sum(is('login_code_entered', 'rejected')),
            sent,
          ),
          countRow('置く操作を始めた数', started),
          shareRow('置く操作が終わった数', sum(is('upload_finished')), started),
          ...REFUSALS.map(([reason, label]) =>
            countRow(
              `置くのを断った数(${label})`,
              sum(is('upload_refused', reason)),
            ),
          ),
          minutes,
        ],
      },
      {
        heading: '何が使われているか',
        rows: [
          countRow('公開された記事', sum(is('article_published'))),
          countRow('足された関連リンク', sum(is('related_link_added'))),
          countRow('ほかのスライドを引用した版', sum(is('citation_made'))),
          countRow('埋め込みの方法を答えた数', sum(is('oembed_served'))),
          countRow('作られたコミュニティ', sum(is('community_created'))),
          countRow('コミュニティのフォロー', sum(is('community_followed'))),
          countRow('作者のフォロー', sum(is('author_followed'))),
          ...EXPORTS.map(([what, label]) =>
            countRow(`書き出し(${label})`, sum(is('export_downloaded', what))),
          ),
          ...topRows(
            weeks,
            totals,
            'mcp_tool_called',
            (t) => t.detail,
            (tool) => `AI エージェントの道具: ${tool}`,
          ),
        ],
      },
      {
        heading: 'どこから来るか',
        rows: [
          countRow(
            '開かれたスライド(参照元なし)',
            sum((t) => t.event === 'deck_opened' && t.referrer === ''),
          ),
          countRow(
            '開かれたスライド(サービスの中から)',
            sum((t) => t.event === 'deck_opened' && t.referrer === 'internal'),
          ),
          ...topRows(
            weeks,
            totals,
            'deck_opened',
            (t) => (t.referrer === 'internal' ? '' : t.referrer),
            (host) => `参照元: ${host}`,
          ),
        ],
      },
      {
        heading: 'ヘルプで解決するか',
        rows: [
          countRow('お問い合わせに進んだ数', sum(is('help_to_contact'))),
          ...topRows(
            weeks,
            totals,
            'help_search_empty',
            (t) => t.detail,
            (word) => `0 件だった検索の語: ${word}`,
          ),
          ...topRows(
            weeks,
            totals,
            'help_article_viewed',
            (t) => t.detail,
            (article) => `記事の閲覧: ${article}`,
          ),
        ],
      },
      {
        heading: '壊れていないか',
        rows: topRows(
          weeks,
          totals,
          'screen_error',
          (t) => `${t.detail} ${t.screen}`,
          (route) => `エラーのページ: ${route}`,
        ),
      },
    ],
  }
}

/** A week's name in the table: its Monday as `M/D`. */
export const weekLabel = (week: Week): string =>
  `${Number(week.start.slice(5, 7))}/${Number(week.start.slice(8, 10))}`
