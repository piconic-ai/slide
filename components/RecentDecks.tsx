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
import { HOME_RECENT_SHOWN } from '../src/site/home-shape'
import { messages, type Lang } from '../src/site/i18n'

const text = messages({
  ja: {
    heading: '最近のスライド',
    failed: '最近のスライドを読み込めませんでした。',
  },
  en: {
    heading: 'Recent slides',
    failed: 'Could not load recent slides.',
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

/**
 * The top page's grid of recent public decks, with its heading. Each card
 * is the shared deck card: a face carrying the deck's name and over it the
 * cover image, under a link to its viewer. No deck runs here. /share.js
 * hides a cover that cannot be read, so the name shows. The static page
 * renders placeholder cards of the size the real ones have, and the cards
 * that did not come leave hidden spares, so the page below does not move
 * (F03-AC83). When no deck is public, the section is left
 * out, heading and all.
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
  const places = createMemo(() =>
    Array.from({ length: HOME_RECENT_SHOWN }, (_, index) => index),
  )
  // The decks that came, then nulls for the places left, which keep the room.
  const slots = createMemo(() => places().map((index) => list()[index] ?? null))
  const t = text[props.lang]
  return (
    <div className="recent-body">
      {decks() === undefined && failed() ? (
        <section className="recent">
          <h2 id="recent">{t.heading}</h2>
          <p className="recent-message">{t.failed}</p>
        </section>
      ) : decks() === undefined ? (
        <section className="recent">
          <h2 id="recent">{t.heading}</h2>
          <ul
            className="deck-grid deck-grid-4 recent-list recent-loading"
            aria-hidden="true"
          >
            {places().map((index) => (
              <li key={index} className="deck-card">
                <span className="card-title">
                  <span className="deck-cover"></span>
                  <span className="deck-name">&nbsp;</span>
                </span>
                <p className="card-meta">&nbsp;</p>
              </li>
            ))}
          </ul>
        </section>
      ) : list().length === 0 ? null : (
        <section className="recent">
          <h2 id="recent">{t.heading}</h2>
          <ul
            className="deck-grid deck-grid-4 recent-list"
            aria-labelledby="recent"
          >
            {slots().map((deck, index) =>
              deck ? (
                <li key={deck.href} className="deck-card">
                  <a className="card-title" href={deck.href}>
                    <span className="deck-cover">
                      <span className="deck-cover-name" aria-hidden="true">
                        {deck.name}
                      </span>
                      {deck.coverUrl ? (
                        <img
                          data-cover
                          src={deck.coverUrl}
                          alt=""
                          loading="lazy"
                          referrerpolicy="no-referrer"
                        />
                      ) : null}
                    </span>
                    <span className="deck-name">{deck.name}</span>
                  </a>
                  <p className="card-meta">
                    <a href={deck.authorHref}>@{deck.handle}</a> ·{' '}
                    <time datetime={deck.publishedAt}>
                      {dayFormats[props.lang].format(
                        new Date(deck.publishedAt),
                      )}
                    </time>
                  </p>
                </li>
              ) : (
                <li
                  key={`spare-${index}`}
                  className="deck-card home-spare"
                  aria-hidden="true"
                >
                  <span className="card-title">
                    <span className="deck-cover"></span>
                    <span className="deck-name">&nbsp;</span>
                  </span>
                  <p className="card-meta">&nbsp;</p>
                </li>
              ),
            )}
          </ul>
        </section>
      )}
    </div>
  )
}
