'use client'

import {
  createEffect,
  createMemo,
  createQuery,
  createSignal,
  http,
} from '@barefootjs/client'
import { dayFormats } from '../src/share/dates'
import type { HomeLists } from '../src/site/home-lists'
import { HOME_FOLLOWING_SHOWN } from '../src/site/home-shape'
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
}

/**
 * The new slides of the people the signed-in visitor follows, on the top
 * page: the few most recently published, as the recent slides show theirs.
 * The page is a static file that does not know its visitor, so the list is
 * fetched after it loads; the answer is null for a visitor who is not signed
 * in, who then gets nothing here.
 *
 * For a signed-in visitor the section always takes the room of a full list
 * (heading and four cards), whatever stands in it: placeholders while the
 * list is on its way, the cards that came, hidden spares for the ones that
 * did not, or a message when nothing came. So the page below does not move
 * when the list arrives. Where the Worker saw no session, CSS keeps the
 * placeholders out of sight (`data-member`, see src/site/home-viewer.ts).
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
  const t = homeText[props.lang]
  return (
    <div className="home-list" data-home-frame="following">
      {waiting() ? (
        <section className="home-following" aria-hidden="true">
          <h2>{t.followingHeading}</h2>
          <ul className="deck-grid deck-grid-4 home-loading">
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
      ) : lists() ? (
        <section className="home-following">
          <h2 id="following-new">{t.followingHeading}</h2>
          <div className="home-following-body">
            <ul
              className="deck-grid deck-grid-4"
              aria-labelledby="following-new"
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
            {decks().length === 0 ? (
              <p className="home-following-empty">{t.followingEmpty}</p>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}
