'use client'

import {
  createEffect,
  createMemo,
  createQuery,
  createSignal,
  http,
} from '@barefootjs/client'
import { citedCountText } from '../src/citations/cited-count'
import { dayFormats } from '../src/share/dates'
import type { HomeLists } from '../src/site/home-lists'
import {
  HOME_FOLLOWING_SHOWN,
  HOME_SIGN_IN_PATH,
  homeTabId,
  type HomeTab,
} from '../src/site/home-shape'
import { homeText } from '../src/site/home-text'
import type { Lang } from '../src/site/i18n'

interface HomeFollowingProps {
  /** The page's language, for the heading and the dates. */
  lang: Lang
  /**
   * Left out on the static top page, so the browser fetches the lists. It
   * stays as the query's seed, which keeps the list's type.
   */
  lists?: HomeLists | null
  /** Moves to another tab, for the buttons that lead there. */
  onShow?: (tab: HomeTab) => void
}

/** The tab whose name the list bears (F03-AC160). */
const FOLLOWING_TAB = homeTabId('following')

/**
 * The "following" tab of the top page: the slides the people the visitor
 * follows published, newest first, as the recent slides show theirs
 * (F21-AC67). The page is a static file that does not know its visitor, so
 * the list is fetched after it loads.
 *
 * The tab always takes the room of its first cards (F03-AC170), whatever
 * stands in it: placeholders while the list is on its way, the cards that
 * came, hidden spares for the ones that did not, and over them a note. A
 * signed-in visitor with nothing to show is told so, with a way to recent
 * slides (F03-AC169); a failed request offers to ask again. A visitor who is
 * not signed in, for whom the answer is null, gets no slides but what
 * following does and a way to sign in to follow (F03-AC167).
 */
export function HomeFollowing(props: HomeFollowingProps) {
  const [lists, load] = createQuery(
    () => http.get<HomeLists | null>('/api/home'),
    { initial: props.lists },
  )
  // Set on the client only: the request never runs on the server.
  const [failed, setFailed] = createSignal(false)
  createEffect(() => setFailed(load.error() !== undefined))
  const waiting = createMemo(() => lists() === undefined && !failed())
  const places = createMemo(() =>
    Array.from({ length: HOME_FOLLOWING_SHOWN }, (_, index) => index),
  )
  const decks = createMemo(() => lists()?.following ?? [])
  // The decks that came, then nulls for the places left, which keep the room.
  const slots = createMemo(() =>
    places().map((index) => decks()[index] ?? null),
  )
  const message = createMemo(() =>
    lists() === undefined && failed()
      ? homeText[props.lang].followingFailed
      : lists() && decks().length === 0
        ? homeText[props.lang].followingEmpty
        : '',
  )
  const t = homeText[props.lang]
  return (
    <div className="home-following">
      <div className="home-room">
        {waiting() ? (
          <ul
            aria-busy="true"
            className="deck-grid deck-grid-4 home-loading"
            aria-labelledby={FOLLOWING_TAB}
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
          <ul className="deck-grid deck-grid-4" aria-labelledby={FOLLOWING_TAB}>
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
            {failed() ? null : (
              <button
                type="button"
                className="button-secondary"
                onClick={() => props.onShow?.('recent')}
              >
                {t.showRecent}
              </button>
            )}
          </div>
        ) : null}
        {lists() === null ? (
          <div className="home-room-note home-prompt" role="status">
            <p className="home-prompt-title">{t.followingPromptTitle}</p>
            <p>{t.followingPromptBody}</p>
            <a className="button-primary" href={HOME_SIGN_IN_PATH}>
              {t.signInToFollow}
            </a>
            <button
              type="button"
              className="button-secondary"
              onClick={() => props.onShow?.('recent')}
            >
              {t.showRecent}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
