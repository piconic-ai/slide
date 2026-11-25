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
import type { HomeCommunityLists } from '../src/site/home-communities'
import {
  FOLLOWED_COMMUNITY_TALKS_PATH,
  HOME_COMMUNITIES_SHOWN,
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
}

/**
 * The new slides of the communities the signed-in visitor follows, on the
 * top page (F31-AC3): the eight most recently published, each card naming
 * its community beside a small mark of its color (F31-AC4), and "see all"
 * to the whole list (F31-AC5). The page is a static file that does not
 * know its visitor, so the list is fetched after it loads.
 *
 * Where the Worker saw that the visitor follows a community, the section
 * takes the room of a full list (heading and eight cards) from the start,
 * as the people's section does: placeholders while the list is on its way,
 * the cards that came, hidden spares for the ones that did not, and over
 * them a message when nothing came or the request failed (F31-AC16). So
 * the page below does not move when the list arrives. For anyone else, CSS
 * keeps the section out of sight (`data-communities`, see
 * src/site/home-viewer.ts), and an answer of null leaves no section
 * (F31-AC6).
 */
export function HomeCommunities(props: HomeCommunitiesProps) {
  const [lists, load] = createQuery(
    () => http.get<HomeCommunityLists | null>('/api/home/communities'),
    { initial: props.lists },
  )
  // Set on the client only: the request never runs on the server.
  const [failed, setFailed] = createSignal(false)
  createEffect(() => setFailed(load.error() !== undefined))
  const waiting = createMemo(() => lists() === undefined && !failed())
  const places = createMemo(() =>
    Array.from({ length: HOME_COMMUNITIES_SHOWN }, (_, index) => index),
  )
  const decks = createMemo(() => lists()?.talks ?? [])
  // The decks that came, then nulls for the places left, which keep the room.
  // A placeholder's line under the name holds the community's line too, as
  // a card's does.
  const slots = createMemo(() =>
    places().map((index) => decks()[index] ?? null),
  )
  const message = createMemo(() =>
    lists() === undefined && failed()
      ? homeText[props.lang].followingFailed
      : lists() && decks().length === 0
        ? homeText[props.lang].communitiesEmpty
        : '',
  )
  const t = homeText[props.lang]
  return (
    <div className="home-list" data-home-frame="communities">
      {lists() === null ? null : (
        <section className="home-communities">
          <div className="home-section-head">
            <h2 id="communities-new">{t.communitiesHeading}</h2>
            <a href={FOLLOWED_COMMUNITY_TALKS_PATH}>{t.seeAll}</a>
          </div>
          <div className="home-room">
            {waiting() ? (
              <ul
                aria-busy="true"
                className="deck-grid deck-grid-4 home-loading"
                aria-labelledby="communities-new"
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
            ) : (
              <ul
                className="deck-grid deck-grid-4"
                aria-labelledby="communities-new"
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
                        <span className="card-community">
                          <span
                            className={`community-mark community-mark-${deck.community.color}`}
                            aria-hidden="true"
                          ></span>
                          <a href={deck.community.href}>
                            {deck.community.name}
                          </a>
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
        </section>
      )}
    </div>
  )
}
