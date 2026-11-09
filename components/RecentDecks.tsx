'use client'

import {
  createEffect,
  createMemo,
  createQuery,
  createSignal,
  http,
} from '@barefootjs/client'
import type { RecentDeck } from '../src/share/recent'

interface RecentDecksProps {
  /**
   * The static top page leaves this out, so the browser fetches the decks.
   * It stays as the query's seed: the compiled server template keeps the
   * prop's type, where an inline `undefined` would type the list as never.
   */
  decks?: RecentDeck[]
}

/**
 * The top page carousel of recent public decks. The static page renders
 * placeholder covers of the same size, so nothing moves when they arrive.
 */
export function RecentDecks(props: RecentDecksProps) {
  const [decks, load] = createQuery(
    () => http.get<RecentDeck[]>('/api/public/decks'),
    { initial: props.decks },
  )
  // The request never runs on the server, so its error reaches the
  // template through a signal that only the client sets.
  const [failed, setFailed] = createSignal(false)
  createEffect(() => setFailed(load.error() !== undefined))
  const list = createMemo(() => decks() ?? [])
  return (
    <div className="recent-body">
      {decks() === undefined && failed() ? (
        <p className="empty">最近のスライドを読み込めませんでした。</p>
      ) : decks() === undefined ? (
        <ul className="recent-list recent-loading" aria-hidden="true">
          <li>
            <div className="recent-cover"></div>
            <p className="card-meta">{' '}</p>
          </li>
          <li>
            <div className="recent-cover"></div>
            <p className="card-meta">{' '}</p>
          </li>
          <li>
            <div className="recent-cover"></div>
            <p className="card-meta">{' '}</p>
          </li>
        </ul>
      ) : list().length === 0 ? (
        <p className="empty">まだ公開されたスライドはありません。</p>
      ) : (
        <ul className="recent-list" aria-labelledby="recent">
          {list().map((deck) => (
            <li key={deck.href}>
              <div className="recent-cover">
                <a className="card-title" href={deck.href}>
                  {deck.name}
                </a>
              </div>
              <p className="card-meta">
                <a href={deck.authorHref}>@{deck.handle}</a> ·{' '}
                <time datetime={deck.publishedAt}>{deck.publishedOn}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
