'use client'

import {
  createEffect,
  createMemo,
  createQuery,
  createSignal,
  http,
} from '@barefootjs/client'
import type { CommunityCard } from '../src/communities/community-card'
import { HOME_NEW_COMMUNITIES_SHOWN, homeTabId } from '../src/site/home-shape'
import { homeText } from '../src/site/home-text'
import type { Lang } from '../src/site/i18n'

/** The tab whose name the list bears (F03-AC160). */
const COMMUNITIES_TAB = homeTabId('communities')

interface NewCommunitiesProps {
  /** The page's language, for the heading and the messages. */
  lang: Lang
  /**
   * Left out on the static top page, so the browser fetches the list. It
   * stays as the query's seed, which keeps the list's type.
   */
  cards?: CommunityCard[]
}

/**
 * The "recent communities" tab of the top page, for every visitor
 * (F03-AC158): the newest communities, as /communities draws them
 * (src/communities/card-markup.ts), two rows of three first (F03-AC161). No
 * "follow" stands on them.
 *
 * The page is a static file, so the list is fetched after it loads. The tab
 * takes the room of its first cards from the start, as the recent slides
 * do: placeholders of a card's height while the list is on its way, the
 * cards that came, hidden spares for the ones that did not, and over them a
 * message when none came or the request failed (F03-AC170).
 */
export function NewCommunities(props: NewCommunitiesProps) {
  const [cards, load] = createQuery(
    () => http.get<CommunityCard[]>('/api/public/communities'),
    { initial: props.cards },
  )
  // Set on the client only: the request never runs on the server.
  const [failed, setFailed] = createSignal(false)
  createEffect(() => setFailed(load.error() !== undefined))
  const waiting = createMemo(() => cards() === undefined && !failed())
  const list = createMemo(() => cards() ?? [])
  const places = createMemo(() =>
    Array.from({ length: HOME_NEW_COMMUNITIES_SHOWN }, (_, index) => index),
  )
  // The cards that came, then nulls for the places left, which keep the room.
  const slots = createMemo(() => places().map((index) => list()[index] ?? null))
  const message = createMemo(() =>
    cards() === undefined && failed()
      ? homeText[props.lang].newCommunitiesFailed
      : cards() && list().length === 0
        ? homeText[props.lang].newCommunitiesEmpty
        : '',
  )
  const t = homeText[props.lang]
  return (
    <div className="home-new-communities">
      <div className="home-room">
        {waiting() ? (
          <ul
            aria-busy="true"
            className="community-grid home-loading"
            aria-labelledby={COMMUNITIES_TAB}
          >
            {places().map((index) => (
              <li key={index} className="community-card">
                <div>
                  <span className="community-card-cover"></span>
                  <span className="community-card-head">
                    <span className="community-card-logo"></span>
                    <span className="community-card-name">&nbsp;</span>
                  </span>
                  <span className="community-card-description">&nbsp;</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="community-grid" aria-labelledby={COMMUNITIES_TAB}>
            {slots().map((card, index) =>
              card ? (
                <li key={card.href} className="community-card">
                  <a href={card.href}>
                    <span
                      className={`community-card-cover community-card-cover-${card.cover.kind}`}
                      aria-hidden="true"
                    >
                      {card.cover.kind === 'image' ? (
                        <img
                          src={card.cover.url}
                          alt=""
                          referrerpolicy="no-referrer"
                        />
                      ) : (
                        card.cover.squares.map((square, at) => (
                          <span key={at} className={square}></span>
                        ))
                      )}
                    </span>
                    <span className="community-card-head">
                      {card.logo.kind === 'image' ? (
                        <img
                          className="community-card-logo"
                          src={card.logo.url}
                          alt=""
                          width="48"
                          height="48"
                        />
                      ) : (
                        <span
                          className={`community-card-logo ${card.logo.className}`}
                          aria-hidden="true"
                        >
                          {card.logo.letter}
                        </span>
                      )}
                      <span className="community-card-name">{card.name}</span>
                    </span>
                    <span className="community-card-description">
                      {card.description}
                    </span>
                  </a>
                </li>
              ) : (
                <li
                  key={`spare-${index}`}
                  className="community-card home-spare"
                  aria-hidden="true"
                >
                  <div>
                    <span className="community-card-cover"></span>
                    <span className="community-card-head">
                      <span className="community-card-logo"></span>
                      <span className="community-card-name">&nbsp;</span>
                    </span>
                    <span className="community-card-description">&nbsp;</span>
                  </div>
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
    </div>
  )
}
