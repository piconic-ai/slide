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
import type { RecentDeck } from '../src/share/recent'
import type { HomeDiscover } from '../src/site/home-discover'
import {
  NOTHING_YET,
  deckAfterOf,
  deckMoreQuery,
  firstQuery,
  receive,
  type MoreList,
} from '../src/site/home-more'
import {
  HOME_SIGN_IN_PATH,
  homeTabId,
  type HomeTab,
} from '../src/site/home-shape'
import { homeText } from '../src/site/home-text'
import type { Lang } from '../src/site/i18n'
import {
  HOME_TIMELINE_FIRST,
  timelineItems,
  type DeckSource,
} from '../src/site/home-timeline'
import { followListStale } from '../src/site/home-follow'
import { HomeCarousel } from './HomeCarousel'

/** A slide of the timeline; the "following" tab's carry their source. */
type TimelineDeck = RecentDeck & Readonly<{ source?: DeckSource }>

interface HomeTimelineProps {
  /** The page's language, for the messages and the dates. */
  lang: Lang
  /** Which tab's list this is: every public slide, or the followed ones. */
  scope: 'all' | 'following'
  /**
   * Whether its tab is the chosen one. Leaving the tab drops the cards "show
   * more" added, so coming back starts from the first (F44-AC16).
   */
  active?: boolean
  /**
   * The carousels' people and communities, for the "all" timeline: while
   * they are on their way the timeline waits, so the slides are drawn once
   * with the carousels among them. Null when they could not be read.
   */
  discover?: HomeDiscover | null
  /** Whether the carousels are still on their way. */
  discovering?: boolean
  /**
   * How many follows and unfollows were saved on the page. The "following"
   * timeline asks for its list again, once, when its tab is in view with a
   * count other than the one it asked at (F44-AC26).
   */
  followChanges?: number
  /** Called after the carousels saved a follow or an unfollow. */
  onFollowChange?: () => void
  /** Moves to another tab, for the button that leads there. */
  onShow?: (tab: HomeTab) => void
}

/** The placeholders drawn while the first slides are on their way. */
const PLACES = Array.from({ length: HOME_TIMELINE_FIRST }, (_, index) => index)

/**
 * The top page's one timeline (F44): the public slides, newest first, in
 * two columns where there is room and in one where there is not, or the
 * slides of the people and communities the visitor follows, as one list.
 * The "all" timeline has its carousels set among the first slides
 * (src/site/home-timeline.ts); what "show more" adds has none (F44-AC16).
 * The page is a static file that does not know its visitor, so the list is
 * fetched after it loads, and a list that came is kept only while its tab is
 * chosen.
 *
 * No place is held for slides that did not come: the list is as long as
 * what came (F44-AC9). A visitor who is not signed in, for whom the
 * "following" answer is null, gets what following does and a way to sign in
 * (F44-AC8). Nothing is loaded by scrolling: the list goes on when "show
 * more" is pressed (F44-AC25).
 */
export function HomeTimeline(props: HomeTimelineProps) {
  // The first slides, or, once "show more" is pressed, the ones after the
  // last shown (src/site/home-more.ts).
  const [after, setAfter] = createSignal<string | null>(null)
  // The follow count the list was asked at.
  const [askedAt, setAskedAt] = createSignal(0)
  const [answer, load] = createQuery(
    () =>
      http.get<TimelineDeck[] | null>(
        `${props.scope === 'all' ? '/api/public/slides' : '/api/home/following-slides'}${after() ?? firstQuery(HOME_TIMELINE_FIRST)}`,
      ),
    {},
  )
  const [shown, setShown] = createSignal<MoreList<TimelineDeck>>(NOTHING_YET)
  createEffect(() => {
    const came = answer()
    if (came === undefined) return
    // Signed out (a session that ran out): drop what was shown and added,
    // so only the prompt stays (F44-AC8).
    if (came === null) {
      setShown(NOTHING_YET)
      return
    }
    setShown(
      receive(
        untrack(() => shown()),
        came,
        (() => {
          const query = untrack(() => after())
          return query === null
            ? { kind: 'first' as const, shown: HOME_TIMELINE_FIRST }
            : { kind: 'more' as const, query }
        })(),
      ),
    )
  })
  createEffect(() => {
    if (props.active === false) setAfter(null)
  })
  // A follow saved while this list was out of view: start again from the
  // first page once it is in view (F44-AC26).
  createEffect(() => {
    const changes = props.followChanges ?? 0
    if (props.scope !== 'following') return
    if (!followListStale(changes, askedAt(), props.active === true)) return
    setAskedAt(changes)
    // A query answers from its cache while the address is the same, so ask
    // for the list outright.
    setAfter(null)
    load()
  })
  // Set on the client only: the request never runs on the server.
  const [failed, setFailed] = createSignal(false)
  createEffect(() => setFailed(load.error() !== undefined))
  const firstCame = createMemo(() => shown().first !== undefined)
  const signedOut = createMemo(() => answer() === null)
  // A failure ends the wait, so the note stands alone and not over placeholders.
  const waiting = createMemo(
    () =>
      !signedOut() &&
      !failed() &&
      (!firstCame() || (props.scope === 'all' && props.discovering === true)),
  )
  // A failure to read more, not of the first cards read again behind them.
  const moreFailed = createMemo(
    () => firstCame() && failed() && after() !== null,
  )
  const decks = createMemo(() => [
    ...(shown().first ?? []),
    ...shown().added.flatMap((added) => added.cards),
  ])
  const present = createMemo(() => ({
    people: props.scope === 'all' && (props.discover?.people.length ?? 0) > 0,
    communities:
      props.scope === 'all' && (props.discover?.communities.length ?? 0) > 0,
  }))
  const items = createMemo(() =>
    timelineItems(
      shown().first ?? [],
      shown().added.flatMap((added) => added.cards),
      present(),
    ),
  )
  const message = createMemo(() =>
    !firstCame() && failed()
      ? homeText[props.lang].failed
      : firstCame() && decks().length === 0
        ? props.scope === 'all'
          ? homeText[props.lang].allEmpty
          : homeText[props.lang].followingEmpty
        : '',
  )
  const showMore = () => {
    const last = decks().at(-1)
    if (last) setAfter(deckMoreQuery(deckAfterOf(last)))
  }
  const t = homeText[props.lang]
  const tabId = homeTabId(props.scope)
  return (
    <div className="home-timeline">
      {waiting() ? (
        <ul
          aria-busy="true"
          className="timeline-list timeline-loading"
          aria-labelledby={tabId}
        >
          {PLACES.map((index) => (
            <li key={index} className="timeline-card">
              <span className="card-cover">
                <span className="deck-cover"></span>
              </span>
              <div className="timeline-card-head">
                <span className="timeline-card-title">&nbsp;</span>
              </div>
              <p className="card-meta">&nbsp;</p>
            </li>
          ))}
        </ul>
      ) : signedOut() || items().length === 0 ? null : (
        <ul className="timeline-list" aria-labelledby={tabId}>
          {items().map((item) =>
            item.kind === 'deck' ? (
              <li key={item.deck.href} className="timeline-card">
                <a className="card-cover" href={item.deck.href} tabindex={-1}>
                  <span className="deck-cover">
                    <span className="deck-cover-name" aria-hidden="true">
                      {item.deck.name}
                    </span>
                    {item.deck.coverUrl ? (
                      <img
                        data-cover
                        src={item.deck.coverUrl}
                        alt=""
                        loading="lazy"
                        referrerpolicy="no-referrer"
                      />
                    ) : null}
                  </span>
                </a>
                <div className="timeline-card-head">
                  <a className="timeline-card-title" href={item.deck.href}>
                    {item.deck.name}
                  </a>
                  <a
                    className="icon-link"
                    href={item.deck.href}
                    aria-label={t.openViewer}
                  >
                    <span>
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M7 17 17 7"></path>
                        <path d="M8 7h9v9"></path>
                      </svg>
                    </span>
                  </a>
                </div>
                <p className="card-meta">
                  <a href={item.deck.authorHref}>@{item.deck.handle}</a>
                  {item.deck.source?.kind === 'person' ? (
                    <span className="source-label">{t.followedAuthor}</span>
                  ) : null}
                  <span aria-hidden="true">·</span>
                  <time datetime={item.deck.publishedAt}>
                    {dayFormats[props.lang].format(
                      new Date(item.deck.publishedAt),
                    )}
                  </time>
                  {citedCountText(item.deck.citedBy, props.lang) ===
                  null ? null : (
                    <span className="card-cited">
                      {citedCountText(item.deck.citedBy, props.lang)}
                    </span>
                  )}
                </p>
                {item.deck.source?.kind === 'community' ? (
                  <p className="card-source">
                    <span
                      className={`community-mark community-mark-${item.deck.source.color}`}
                      aria-hidden="true"
                    ></span>
                    <a href={item.deck.source.href}>{item.deck.source.name}</a>
                  </p>
                ) : null}
              </li>
            ) : (
              <li
                key={`carousel-${item.carousel}`}
                className="timeline-carousel"
              >
                <HomeCarousel
                  lang={props.lang}
                  kind={item.carousel}
                  signedIn={props.discover?.signedIn === true}
                  people={props.discover?.people}
                  communities={props.discover?.communities}
                  onFollowChange={props.onFollowChange}
                />
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
        <div className="home-timeline-note" role="status">
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
          {failed() || props.scope === 'all' ? null : (
            <button
              type="button"
              className="button-secondary"
              onClick={() => props.onShow?.('all')}
            >
              {t.showAll}
            </button>
          )}
        </div>
      ) : null}
      {signedOut() ? (
        <div className="home-timeline-note home-prompt" role="status">
          <p className="home-prompt-title">{t.followingPromptTitle}</p>
          <p>{t.followingPromptBody}</p>
          <a className="button-primary" href={HOME_SIGN_IN_PATH}>
            {t.signInToFollow}
          </a>
          <button
            type="button"
            className="button-secondary"
            onClick={() => props.onShow?.('all')}
          >
            {t.showAll}
          </button>
        </div>
      ) : null}
      {firstCame() && !signedOut() && shown().more && !moreFailed() ? (
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
