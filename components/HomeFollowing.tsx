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
import {
  HOME_SHAPE_KEY,
  keptHomeShape,
  SESSION_KEY,
} from '../src/site/home-shape'
import { homeText } from '../src/site/home-text'
import type { Lang } from '../src/site/i18n'

interface HomeFollowingProps {
  /** The page's language, for the heading and the dates. */
  lang: Lang
  /** Left out on the static top page; see HomeOwnSlides. */
  lists?: HomeLists | null
}

/**
 * The new slides of the people the signed-in visitor follows, on the top
 * page: the few most recently published, as the recent slides show theirs.
 * It reads the same answer as HomeOwnSlides, which the two share as one
 * request, and holds the shape that answer had last time while it is on its
 * way. When the visitor follows nobody, or nobody they follow has a public
 * slide, the section is left out, heading and all.
 */
export function HomeFollowing(props: HomeFollowingProps) {
  const [lists, load] = createQuery(
    () => http.get<HomeLists | null>('/api/home'),
    { initial: props.lists },
  )
  const [failed, setFailed] = createSignal(false)
  const [kept, setKept] = createSignal(0)
  createEffect(() => setFailed(load.error() !== undefined))
  createEffect(() => {
    // Storage may be blocked, and what it holds is only a hint for drawing.
    try {
      if (lists() === undefined)
        setKept(
          keptHomeShape(
            localStorage.getItem(SESSION_KEY),
            localStorage.getItem(HOME_SHAPE_KEY),
          ).following,
        )
    } catch {}
  })
  const waiting = createMemo(() => lists() === undefined && !failed())
  const ghosts = createMemo(() =>
    waiting() ? Array.from({ length: kept() }, (_, index) => index) : [],
  )
  const decks = createMemo(() => lists()?.following ?? [])
  const t = homeText[props.lang]
  return (
    <div className="home-list" data-home-frame="following">
      {ghosts().length > 0 ? (
        <section className="home-following" aria-hidden="true">
          <h2>{t.followingHeading}</h2>
          <ul className="deck-grid deck-grid-4 home-loading">
            {ghosts().map((index) => (
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
      ) : decks().length === 0 ? null : (
        <section className="home-following">
          <h2 id="following-new">{t.followingHeading}</h2>
          <ul className="deck-grid deck-grid-4" aria-labelledby="following-new">
            {decks().map((deck) => (
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
                    {dayFormats[props.lang].format(new Date(deck.publishedAt))}
                  </time>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
