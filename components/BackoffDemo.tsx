'use client'

import { createMemo, createSignal } from '@barefootjs/client'
import {
  BACKOFF_FACTOR,
  BACKOFF_FIRST_MS,
  BACKOFF_TRIES,
  backoffSchedule,
  seconds,
  totalWaitMs,
} from '../src/share/backoff'
import { messages, type Lang } from '../src/site/i18n'

const text = messages({
  ja: {
    title: '指数バックオフ: 何回目に、何秒待つか',
    factor: '倍率',
    tries: '回数',
    triesValue: (tries: number) => `${tries} 回`,
    attempt: (attempt: number) => `${attempt}回目`,
    note: (first: string, total: string) =>
      `初回 ${first}。上段は試行、下段はその前に待つ時間。合計 ${total}。`,
  },
  en: {
    title: 'Exponential backoff: how long before each try',
    factor: 'Factor',
    tries: 'Tries',
    triesValue: (tries: number) => `${tries}`,
    attempt: (attempt: number) => `Try ${attempt}`,
    note: (first: string, total: string) =>
      `First wait ${first}. Top: each try; bottom: the wait before it. ${total} in total.`,
  },
})

interface BackoffDemoProps {
  /** The page's language, for the labels. */
  lang: Lang
}

/**
 * The top page's live slide: move the factor and the number of tries, and
 * the wait before each try and the total change on the spot. The static
 * page shows the starting values, so it reads the same before the script.
 */
export function BackoffDemo(props: BackoffDemoProps) {
  const [factor, setFactor] = createSignal<number>(BACKOFF_FACTOR.initial)
  const [tries, setTries] = createSignal<number>(BACKOFF_TRIES.initial)
  const steps = createMemo(() => backoffSchedule(factor(), tries()))
  const t = text[props.lang]
  return (
    <div className="mock-slide">
      <div className="mock-title">{t.title}</div>
      <div className="mock-controls">
        <label className="mock-control">
          <span>{t.factor}</span>
          <input
            type="range"
            min={BACKOFF_FACTOR.min}
            max={BACKOFF_FACTOR.max}
            step={BACKOFF_FACTOR.step}
            value={factor()}
            onInput={(event) =>
              setFactor(Number((event.target as HTMLInputElement).value))
            }
          />
          <output aria-hidden="true">×{factor()}</output>
        </label>
        <label className="mock-control">
          <span>{t.tries}</span>
          <input
            type="range"
            min={BACKOFF_TRIES.min}
            max={BACKOFF_TRIES.max}
            step={BACKOFF_TRIES.step}
            value={tries()}
            onInput={(event) =>
              setTries(Number((event.target as HTMLInputElement).value))
            }
          />
          <output aria-hidden="true">{t.triesValue(tries())}</output>
        </label>
      </div>
      <ol className="mock-timeline">
        {steps().map((step) => (
          // A row keyed by its try alone keeps its old wait when the factor
          // changes (BarefootJS 0.40.2 reuses the row without re-rendering
          // it), so the wait is part of the key.
          <li key={`${step.attempt}:${step.waitMs}`}>
            <b>{t.attempt(step.attempt)}</b>
            <i></i>
            <small>
              {step.waitMs === 0 ? '0s' : `+${seconds(step.waitMs)}`}
            </small>
          </li>
        ))}
      </ol>
      {/* The slider speaks its own value; only the total is announced. */}
      <div className="mock-note" aria-live="polite">
        {t.note(seconds(BACKOFF_FIRST_MS), seconds(totalWaitMs(steps())))}
      </div>
      <span className="mock-no">15</span>
    </div>
  )
}
