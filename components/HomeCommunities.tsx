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
import { dayFormats } from '../src/share/dates'
import type {
  CommunityRecentDeck,
  HomeCommunityLists,
} from '../src/site/home-communities'
import {
  NOTHING_YET,
  deckAfterOf,
  deckMoreQuery,
  firstQuery,
  receive,
  shownCards,
  type MoreList,
} from '../src/site/home-more'
import {
  HOME_COMMUNITIES_SHOWN,
  HOME_SIGN_IN_PATH,
  homeTabId,
  type HomeTab,
} from '../src/site/home-shape'
import { homeText } from '../src/site/home-text'
import type { Lang } from '../src/site/i18n'

interface HomeCommunitiesProps {
  /** The page's language, for the heading and the dates. */
  lang: Lang
  /**
   * Left out on the static top page, so the browser fetches the list. It
   * stays as the query's seed, which keeps the list's type.
   */
  lists?: HomeCommunityLists | null
  /** Moves to another tab, for the buttons that lead there. */
  onShow?: (tab: HomeTab) => void
  /** Whether its tab is chosen; leaving it drops what "show more" added. */
  active?: boolean
}

/** The tab whose name the list bears (F03-AC160). */
const FOLLOWED_TAB = homeTabId('followed-communities')

/**
 * The "followed communities" tab of the top page: the slides of the
 * communities the visitor follows, newest first, each card naming its
 * community beside a small mark of its color (F31-AC4). The page is a static
 * file that does not know its visitor, so the list is fetched after it
 * loads.
 *
 * The tab takes the room of its first cards (F03-AC175), as the
 * "following" tab does: placeholders, the cards that came, hidden spares,
 * and over them a note. A signed-in visitor with nothing to show, followed
 * communities or not, is told so, with a way to recent communities
 * (F03-AC169); a visitor who is not signed in, for whom the answer is null,
 * gets what following a community does and a way to sign in (F03-AC168).
 */
export function HomeCommunities(props: HomeCommunitiesProps) {
  // The first slides, or, once "show more" is pressed, the ones after the
  // last shown (src/site/home-more.ts).
  const [after, setAfter] = createSignal<string | null>(null)
  const [lists, load] = createQuery(
    () =>
      http.get<HomeCommunityLists | null>(
        `/api/home/communities${after() ?? firstQuery(HOME_COMMUNITIES_SHOWN)}`,
      ),
    { initial: props.lists },
  )
  const [shown, setShown] =
    createSignal<MoreList<CommunityRecentDeck>>(NOTHING_YET)
  createEffect(() => {
    const came = lists()
    if (came === undefined) return
    // Signed out (a session that ran out): drop what was shown and added,
    // so only the prompt stays (F03-AC167, F03-AC168).
    if (came === null) {
      setShown(NOTHING_YET)
      return
    }
    setShown(
      receive(
        untrack(() => shown()),
        came.talks,
        (() => {
          const query = untrack(() => after())
          return query === null
            ? { kind: 'first' as const, shown: HOME_COMMUNITIES_SHOWN }
            : { kind: 'more' as const, query }
        })(),
      ),
    )
  })
  createEffect(() => {
    if (props.active === false) setAfter(null)
  })
  // Set on the client only: the request never runs on the server.
  const [failed, setFailed] = createSignal(false)
  createEffect(() => setFailed(load.error() !== undefined))
  const firstCame = createMemo(() => shown().first !== undefined)
  // Placeholders until the first cards are sorted out of the answer, so the
  // grid is drawn once with its cards in place. A visitor who is not signed
  // in gets null, and the grid of spares under the prompt.
  const waiting = createMemo(
    () => !firstCame() && !failed() && lists() !== null,
  )
  // A failure to read more, not of the first cards read again behind them.
  const moreFailed = createMemo(
    () => firstCame() && failed() && after() !== null,
  )
  const places = createMemo(() =>
    Array.from({ length: HOME_COMMUNITIES_SHOWN }, (_, index) => index),
  )
  const decks = createMemo(() => shownCards(shown()))
  // The decks that came, then nulls for the places left, which keep the
  // room, then the decks "show more" added. A placeholder's line under the
  // name holds the community's line too, as a card's does.
  const slots = createMemo(() => [
    ...places().map((index) => shown().first?.[index] ?? null),
    ...shown().added.flatMap((added) => added.cards),
  ])
  // Nothing to show: no room is held, and the note stands alone.
  const empty = createMemo(
    () => lists() === null || (firstCame() && decks().length === 0),
  )
  const message = createMemo(() =>
    !firstCame() && failed()
      ? homeText[props.lang].followingFailed
      : firstCame() && decks().length === 0
        ? homeText[props.lang].communitiesEmpty
        : '',
  )
  const showMore = () => {
    const last = decks().at(-1)
    if (last) setAfter(deckMoreQuery(deckAfterOf(last)))
  }
  const t = homeText[props.lang]
  return (
    <div className="home-communities">
      <div className="home-room">
        {waiting() ? (
          <ul
            aria-busy="true"
            className="deck-grid deck-grid-4 home-loading"
            aria-labelledby={FOLLOWED_TAB}
          >
            {places().map((index) => (
              <li key={index} className="deck-card">
                <span className="card-title">
                  <span className="deck-cover"></span>
                  <span className="deck-name">&nbsp;</span>
                </span>
                <p className="card-meta">
                  &nbsp;<span className="card-community">&nbsp;</span>
                </p>
              </li>
            ))}
          </ul>
        ) : empty() ? null : (
          <ul className="deck-grid deck-grid-4" aria-labelledby={FOLLOWED_TAB}>
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
                    <span className="card-community">
                      <span
                        className={`community-mark community-mark-${deck.community.color}`}
                        aria-hidden="true"
                      ></span>
                      <a href={deck.community.href}>{deck.community.name}</a>
                    </span>
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
                  <p className="card-meta">
                    &nbsp;<span className="card-community">&nbsp;</span>
                  </p>
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
          <div
            className={
              empty() ? 'home-room-note home-room-empty' : 'home-room-note'
            }
            role="status"
          >
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
                onClick={() => props.onShow?.('communities')}
              >
                {t.showCommunities}
              </button>
            )}
          </div>
        ) : null}
        {lists() === null ? (
          <div
            className="home-room-note home-prompt home-room-empty"
            role="status"
          >
            <p className="home-prompt-title">{t.communitiesPromptTitle}</p>
            <p>{t.communitiesPromptBody}</p>
            <a className="button-primary" href={HOME_SIGN_IN_PATH}>
              {t.signInToFollow}
            </a>
            <button
              type="button"
              className="button-secondary"
              onClick={() => props.onShow?.('communities')}
            >
              {t.showCommunities}
            </button>
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
          {t.more}
        </button>
      ) : null}
      {moreFailed() ? (
        <div className="home-more-note" role="status">
          <p>{t.moreFailed}</p>
          <button
            type="button"
            className="button-secondary"
            onClick={() => load()}
          >
            {t.retry}
          </button>
        </div>
      ) : null}
    </div>
  )
}
