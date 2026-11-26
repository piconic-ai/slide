'use client'

import {
  createEffect,
  createMemo,
  createQuery,
  createSignal,
  http,
  untrack,
} from '@barefootjs/client'
import { citedCountText } from '../src/citations/cited-count'
import type { RecentDeck } from '../src/share/recent'
import { dayFormats } from '../src/share/dates'
import {
  NOTHING_YET,
  deckAfterOf,
  deckMoreQuery,
  firstQuery,
  receive,
  shownCards,
  type MoreList,
} from '../src/site/home-more'
import { HOME_RECENT_SHOWN, homeTabId } from '../src/site/home-shape'
import { homeText } from '../src/site/home-text'
import { messages, type Lang } from '../src/site/i18n'

const text = messages({
  ja: {
    failed: '最近のスライドを読み込めませんでした。',
    empty: '公開されたスライドは、まだありません。',
    loading: '読み込み中',
    retry: 'もう一度読み込む',
  },
  en: {
    failed: 'Could not load recent slides.',
    empty: 'No slide is public yet.',
    loading: 'Loading',
    retry: 'Try again',
  },
})

/** The tab whose name the list bears (F03-AC160). */
const RECENT_TAB = homeTabId('recent')

interface RecentDecksProps {
  /** The page's language, for the messages and the dates. */
  lang: Lang
  /**
   * The static top page leaves this out, so the browser fetches the decks.
   * It stays as the query's seed: the compiled server template keeps the
   * prop's type, where an inline `undefined` would type the list as never.
   */
  decks?: RecentDeck[]
  /**
   * Whether its tab is the chosen one. Leaving the tab drops the cards
   * "show more" added, so coming back starts from the first (F03-AC166).
   */
  active?: boolean
}

/**
 * The top page's grid of recent public decks, with its heading. Each card
 * is the shared deck card: a face carrying the deck's name and over it the
 * cover image, under a link to its viewer. No deck runs here. /share.js
 * hides a cover that cannot be read, so the name shows. The static page
 * renders placeholder cards of the size the real ones have, and the cards
 * that did not come leave hidden spares, so the page below does not move
 * (F03-AC83). When no deck is public, or the request failed, the section
 * keeps its room and says so over the spares (a failure with a button to
 * ask again).
 */
export function RecentDecks(props: RecentDecksProps) {
  // The query asks for the first decks, or, once "show more" is pressed,
  // for the ones after the last shown (src/site/home-more.ts).
  const [after, setAfter] = createSignal<string | null>(null)
  const [decks, load] = createQuery(
    () =>
      http.get<RecentDeck[]>(
        `/api/public/slides${after() ?? firstQuery(HOME_RECENT_SHOWN)}`,
      ),
    { initial: props.decks },
  )
  const [shown, setShown] = createSignal<MoreList<RecentDeck>>(NOTHING_YET)
  createEffect(() => {
    const came = decks()
    if (came === undefined) return
    setShown(
      receive(
        untrack(() => shown()),
        came,
        untrack(() => after()) === null
          ? { kind: 'first', shown: HOME_RECENT_SHOWN }
          : { kind: 'more' },
      ),
    )
  })
  createEffect(() => {
    if (props.active === false) setAfter(null)
  })
  // The request never runs on the server, so its error reaches the
  // template through a signal that only the client sets.
  const [failed, setFailed] = createSignal(false)
  createEffect(() => setFailed(load.error() !== undefined))
  const firstCame = createMemo(() => shown().first !== undefined)
  const waiting = createMemo(() => !firstCame() && !failed())
  const moreFailed = createMemo(() => firstCame() && failed())
  const list = createMemo(() => shownCards(shown()))
  const places = createMemo(() =>
    Array.from({ length: HOME_RECENT_SHOWN }, (_, index) => index),
  )
  // The decks that came, then nulls for the places left, which keep the
  // room, then the decks "show more" added.
  const slots = createMemo(() => [
    ...places().map((index) => shown().first?.[index] ?? null),
    ...shown().added,
  ])
  const message = createMemo(() =>
    !firstCame() && failed()
      ? text[props.lang].failed
      : firstCame() && list().length === 0
        ? text[props.lang].empty
        : '',
  )
  const showMore = () => {
    const last = list().at(-1)
    if (last) setAfter(deckMoreQuery(deckAfterOf(last)))
  }
  const t = text[props.lang]
  const h = homeText[props.lang]
  return (
    <div className="recent-body">
      <div className="home-room">
        {waiting() ? (
          <ul
            aria-busy="true"
            className="deck-grid deck-grid-4 recent-list recent-loading"
            aria-labelledby={RECENT_TAB}
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
        ) : (
          <ul
            className="deck-grid deck-grid-4 recent-list"
            aria-labelledby={RECENT_TAB}
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
                    {citedCountText(deck.citedBy, props.lang) ===
                    null ? null : (
                      <span className="card-cited">
                        {' · '}
                        {citedCountText(deck.citedBy, props.lang)}
                      </span>
                    )}
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
        )}
        {waiting() ? (
          <p className="visually-hidden" role="status">
            {t.loading}
          </p>
        ) : null}
        {message() !== '' ? (
          <div className="home-room-note" role="status">
            <p>{message()}</p>
            {failed() ? (
              <button
                type="button"
                className="button-secondary"
                onClick={() => load()}
              >
                {t.retry}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {shown().more && !moreFailed() ? (
        <button
          type="button"
          className="button-secondary home-more"
          disabled={load.isPending()}
          onClick={() => showMore()}
        >
          {h.more}
        </button>
      ) : null}
      {moreFailed() ? (
        <div className="home-more-note" role="status">
          <p>{h.moreFailed}</p>
          <button
            type="button"
            className="button-secondary"
            onClick={() => load()}
          >
            {h.retry}
          </button>
        </div>
      ) : null}
    </div>
  )
}
