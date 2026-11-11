'use client'

import { createMemo, createSignal } from '@barefootjs/client'
import { messages, type Lang } from '../src/site/i18n'

/** One axis of the review: its score out of five and what backs it. */
type Axis = Readonly<{
  label: string
  score: number
  finding: string
  pages: string
}>

const text = messages<{
  head: string
  foot: string
  axes: readonly Axis[]
}>({
  ja: {
    head: 'AI レビュー · 著者が公開 · スライド本文とノートだけを読んで評価',
    foot: '総評: 手を動かしながら読める、実装者向けの記事。数字と判断理由が揃っている。',
    axes: [
      {
        label: '試せる',
        score: 4,
        finding:
          '15 ページのバックオフと 18 ページのキャッシュ TTL は、読む人が値を変えて挙動を確かめられる。3 ページのアーキテクチャ図は静止画のままで、ここは試せない。',
        pages: 'p.15, p.18 / p.3',
      },
      {
        label: '文脈が足りる',
        score: 5,
        finding:
          '1〜3 ページで、なぜ Workers を選び、何と比べたのかを先に説明している。前提を知らなくても、後半の判断理由を追える。',
        pages: 'p.1–3',
      },
      {
        label: '具体的',
        score: 4,
        finding:
          'CPU 時間 10ms、リトライ 3 回で 503 など、判断が数字で書かれている。キャッシュの節は設定値だけで、測った結果がない。',
        pages: 'p.14, p.16 / p.18–20',
      },
      {
        label: '独自の知見',
        score: 4,
        finding:
          'リトライを 3 回で打ち切った理由は、運用してわかった話で、公式ドキュメントにはない。D1 の説明は公式の内容に近い。',
        pages: 'p.16 / p.5–9',
      },
      {
        label: '読みやすい',
        score: 5,
        finding:
          '1 枚に主張が 1 つで、ノートがそのまま文章として読める。図と本文で用語がそろっている。',
        pages: 'p.1–24',
      },
    ],
  },
  en: {
    head: 'AI review · shared by the author · based only on the slides and notes',
    foot: 'Overall: a write-up for implementers that you can follow by doing. The numbers and the reasons behind each decision are all there.',
    axes: [
      {
        label: 'Hands-on',
        score: 4,
        finding:
          'Readers can change the values in the backoff on page 15 and the cache TTL on page 18 and watch what happens. The architecture diagram on page 3 is a still image, so there is nothing to try there.',
        pages: 'p.15, p.18 / p.3',
      },
      {
        label: 'Enough context',
        score: 5,
        finding:
          'Pages 1 to 3 explain first why Workers was chosen and what it was compared with. You can follow the later decisions without knowing the background.',
        pages: 'p.1–3',
      },
      {
        label: 'Concrete',
        score: 4,
        finding:
          'Decisions come with numbers: a 10ms CPU limit, 503 after 3 retries. The cache section gives only the settings, with nothing measured.',
        pages: 'p.14, p.16 / p.18–20',
      },
      {
        label: 'Original insight',
        score: 4,
        finding:
          'Why retries stop at 3 comes from running the service and is not in the official docs. The part on D1 stays close to the official material.',
        pages: 'p.16 / p.5–9',
      },
      {
        label: 'Readable',
        score: 5,
        finding:
          'One point per slide, and the notes read as prose. The diagrams and the text use the same terms.',
        pages: 'p.1–24',
      },
    ],
  },
})

/** A score as five dots, filled up to the score. */
const dots = (score: number) => '●'.repeat(score) + '○'.repeat(5 - score)

interface ReviewDemoProps {
  /** The page's language, for the review. */
  lang: Lang
}

/**
 * The top page's AI review card: choose an axis, and the finding beside it
 * shows that axis's score, what backs it, and the pages it points at.
 */
export function ReviewDemo(props: ReviewDemoProps) {
  const t = text[props.lang]
  const [selected, setSelected] = createSignal<number>(0)
  const axis = createMemo(() => t.axes[selected()] ?? t.axes[0])
  const total = t.axes.reduce((sum, { score }) => sum + score, 0)
  return (
    <div className="mock-card">
      <div className="mock-card-head">
        <span>{t.head}</span>
        <span className="mono">{`${total}/${t.axes.length * 5}`}</span>
      </div>
      <div className="mock-review">
        <ul className="mock-axes">
          {t.axes.map((item, index) => (
            <li key={item.label}>
              <button
                type="button"
                aria-pressed={selected() === index ? 'true' : 'false'}
                onClick={() => setSelected(index)}
              >
                <span>{item.label}</span>
                <span>{dots(item.score)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mock-finding" aria-live="polite">
          <b>{`${axis().label} ${axis().score}/5`}</b>
          <p>{axis().finding}</p>
          <small className="mono">{axis().pages}</small>
        </div>
      </div>
      <div className="mock-card-foot">{t.foot}</div>
    </div>
  )
}
