'use client'

import { createMemo, createSignal } from '@barefootjs/client'
import { messages, type Lang } from '../src/site/i18n'

/** One page of the deck: its number, its slide, and what was said over it. */
type Page = Readonly<{ no: number; slide: string; note: string }>

/** How the reader takes the deck in. */
type Mode = 'notes' | 'slides'

const text = messages<{
  head: string
  modes: Readonly<Record<Mode, string>>
  noteLabel: (no: number) => string
  previous: string
  next: string
  pages: readonly Page[]
}>({
  ja: {
    head: 'Hono on Workers · 24 ページ · ノートあり',
    modes: { notes: 'ノートで読む', slides: 'スライドでめくる' },
    noteLabel: (no) => `発表者のノート · p.${no}`,
    previous: '前のページ',
    next: '次のページ',
    pages: [
      {
        no: 14,
        slide: 'なぜ Workers なのか',
        note: 'isolate ベースなのでコールドスタートがほぼなく、D1 と R2 が同じ境界の中にいます。スライド配信は「小さなファイルを大量に読む」ワークロードなので、CPU 時間 10ms の制限があっても困りません。',
      },
      {
        no: 15,
        slide: '指数バックオフ',
        note: 'このページのデモは手元で動かしてください。倍率 2 で 5 回なら、合計で 7.5 秒待つことになります。',
      },
      {
        no: 16,
        slide: '3 回で諦める',
        note: '配信側のリトライは 3 回までにしました。それ以上待たせるより、503 を返してクライアント側で再読み込みしてもらうほうが、読む人を待たせません。',
      },
    ],
  },
  en: {
    head: 'Hono on Workers · 24 pages · with notes',
    modes: { notes: 'Read with notes', slides: 'Flip through slides' },
    noteLabel: (no) => `Speaker notes · p.${no}`,
    previous: 'Previous page',
    next: 'Next page',
    pages: [
      {
        no: 14,
        slide: 'Why Workers',
        note: 'Isolates mean almost no cold starts, and D1 and R2 sit inside the same boundary. Serving slides means reading many small files, so the 10ms CPU limit is no problem.',
      },
      {
        no: 15,
        slide: 'Exponential backoff',
        note: 'Try the demo on this page yourself. With a factor of 2 and 5 tries, you wait 7.5 seconds in total.',
      },
      {
        no: 16,
        slide: 'Give up after 3',
        note: 'The server retries at most 3 times. Rather than keep readers waiting longer, it answers 503 and the client reloads.',
      },
    ],
  },
})

const MODES = ['notes', 'slides'] as const satisfies readonly Mode[]

interface NotesDemoProps {
  /** The page's language, for the deck. */
  lang: Lang
}

/**
 * The top page's notes card: read the deck as slides beside what the speaker
 * said, or flip through the slides one at a time. Both views are in the
 * markup and the toggle only hides one, so the page reads before the script.
 */
export function NotesDemo(props: NotesDemoProps) {
  const t = text[props.lang]
  const last = t.pages.length - 1
  const [mode, setMode] = createSignal<Mode>('notes')
  const [current, setCurrent] = createSignal<number>(0)
  const page = createMemo(() => t.pages[current()] ?? t.pages[0])
  return (
    <div className="mock-card">
      <div className="mock-card-head">
        <span>{t.head}</span>
        <span className="mock-toggle">
          {MODES.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={mode() === item ? 'true' : 'false'}
              onClick={() => setMode(item)}
            >
              {t.modes[item]}
            </button>
          ))}
        </span>
      </div>
      <div className="mock-notes" hidden={mode() !== 'notes'}>
        {t.pages.map((item) => (
          <div key={item.no} className="mock-note-row">
            <div className="mock-thumb">{item.slide}</div>
            <div className="mock-speaker">
              <small>{t.noteLabel(item.no)}</small>
              <p>{item.note}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mock-flip" hidden={mode() !== 'slides'}>
        <div className="mock-slide mock-cover">
          <div>{page().slide}</div>
          <span className="mock-no">{page().no}</span>
        </div>
        <div className="mock-pager">
          <button
            type="button"
            aria-label={t.previous}
            disabled={current() === 0}
            onClick={() => setCurrent(Math.max(0, current() - 1))}
          >
            ‹
          </button>
          <span className="mono">{`${current() + 1} / ${t.pages.length}`}</span>
          <button
            type="button"
            aria-label={t.next}
            disabled={current() === last}
            onClick={() => setCurrent(Math.min(last, current() + 1))}
          >
            ›
          </button>
        </div>
      </div>
    </div>
  )
}
