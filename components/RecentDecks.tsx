'use client'

import {
  createEffect,
  createMemo,
  createQuery,
  createSignal,
  http,
} from '@barefootjs/client'
import type { RecentDeck } from '../src/share/recent'
import { dayFormats } from '../src/share/dates'
import { messages, type Lang } from '../src/site/i18n'

const text = messages({
  ja: {
    failed: '最近のスライドを読み込めませんでした。',
    empty: 'まだ公開されたスライドはありません。',
  },
  en: {
    failed: 'Could not load recent slides.',
    empty: 'No slides have been published yet.',
  },
})

interface RecentDecksProps {
  /** The page's language, for the messages and the dates. */
  lang: Lang
  /**
   * The static top page leaves this out, so the browser fetches the decks.
   * It stays as the query's seed: the compiled server template keeps the
   * prop's type, where an inline `undefined` would type the list as never.
   */
  decks?: RecentDeck[]
}

/** Until its image has loaded, a cover shows the deck's name. */
function showCover(event: Event) {
  ;(event.currentTarget as HTMLImageElement).classList.add('drawn')
}

/** A cover that cannot be loaded gives way to the deck's name. */
function showName(event: Event) {
  ;(event.currentTarget as HTMLImageElement).remove()
}

/**
 * The top page carousel of recent public decks. Each cover is an image: the
 * one the deck names, or else its first slide as the service takes it, under
 * a link to its viewer. No deck runs here. The
 * static page renders placeholder covers, and messages sit in a cover of the same size, so
 * nothing below moves whatever the request returns.
 */
export function RecentDecks(props: RecentDecksProps) {
  const [decks, load] = createQuery(
    () => http.get<RecentDeck[]>('/api/public/slides'),
    { initial: props.decks },
  )
  // The request never runs on the server, so its error reaches the
  // template through a signal that only the client sets.
  const [failed, setFailed] = createSignal(false)
  createEffect(() => setFailed(load.error() !== undefined))
  const list = createMemo(() => decks() ?? [])
  const t = text[props.lang]
  return (
    <div className="recent-body">
      {decks() === undefined && failed() ? (
        <ul className="recent-list recent-message">
          <li className="deck-card">
            <div className="recent-cover">
              <p className="empty">{t.failed}</p>
            </div>
            <p className="card-meta">{'\u00a0'}</p>
          </li>
        </ul>
      ) : decks() === undefined ? (
        <ul className="recent-list recent-loading" aria-hidden="true">
          <li className="deck-card">
            <div className="recent-cover"></div>
            <p className="card-meta">{' '}</p>
          </li>
          <li className="deck-card">
            <div className="recent-cover"></div>
            <p className="card-meta">{' '}</p>
          </li>
          <li className="deck-card">
            <div className="recent-cover"></div>
            <p className="card-meta">{' '}</p>
          </li>
        </ul>
      ) : list().length === 0 ? (
        <ul className="recent-list recent-message">
          <li className="deck-card">
            <div className="recent-cover">
              <p className="empty">{t.empty}</p>
            </div>
            <p className="card-meta">{'\u00a0'}</p>
          </li>
        </ul>
      ) : (
        <ul className="recent-list" aria-labelledby="recent">
          {list().map((deck) => (
            <li key={deck.href} className="deck-card">
              <div className="recent-cover">
                {deck.coverUrl ? (
                  <img
                    src={deck.coverUrl}
                    alt=""
                    loading="lazy"
                    referrerpolicy="no-referrer"
                    onLoad={showCover}
                    onError={showName}
                  />
                ) : null}
                <a className="card-title" href={deck.href} title={deck.name}>
                  {deck.name}
                </a>
              </div>
              <p className="card-meta">
                <a href={deck.authorHref}>@{deck.handle}</a> ·{' '}
                <time datetime={deck.publishedAt}>
                  {dayFormats[props.lang].format(new Date(deck.publishedAt))}
                </time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
