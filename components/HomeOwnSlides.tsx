'use client'

import {
  createEffect,
  createMemo,
  createQuery,
  createSignal,
  http,
} from '@barefootjs/client'
import type { HomeLists } from '../src/site/home-lists'
import {
  HOME_SHAPE_KEY,
  homeShapeOf,
  keptHomeShape,
  SESSION_KEY,
} from '../src/site/home-shape'
import { homeText } from '../src/site/home-text'
import type { Lang } from '../src/site/i18n'

interface HomeOwnSlidesProps {
  /** The page's language, for the heading and the tags. */
  lang: Lang
  /**
   * The static top page leaves this out, so the browser fetches the lists.
   * It stays as the query's seed, which keeps the list's type.
   */
  lists?: HomeLists | null
}

/**
 * The signed-in visitor's own slides on the top page: the few most recently
 * changed, each saying whether readers can open it and leading to its own
 * page. The page is a static file that does not know its visitor, so the
 * list is fetched after it loads; the answer is null for a visitor who is
 * not signed in. While it is on its way, a visitor this browser last saw
 * signed in gets cards of the shape the list had then, so the page does not
 * move when the list comes. Without a slide the section is left out, heading
 * and all.
 */
export function HomeOwnSlides(props: HomeOwnSlidesProps) {
  const [lists, load] = createQuery(
    () => http.get<HomeLists | null>('/api/home'),
    { initial: props.lists },
  )
  // Set on the client only: the request never runs on the server, and what
  // this browser kept is not known there.
  const [failed, setFailed] = createSignal(false)
  const [kept, setKept] = createSignal(0)
  createEffect(() => setFailed(load.error() !== undefined))
  createEffect(() => {
    // Storage may be blocked, and what it holds is only a hint for drawing.
    try {
      const answer = lists()
      if (answer === undefined)
        setKept(
          keptHomeShape(
            localStorage.getItem(SESSION_KEY),
            localStorage.getItem(HOME_SHAPE_KEY),
          ).own,
        )
      else
        localStorage.setItem(
          HOME_SHAPE_KEY,
          JSON.stringify(homeShapeOf(answer)),
        )
    } catch {}
  })
  const waiting = createMemo(() => lists() === undefined && !failed())
  const ghosts = createMemo(() =>
    waiting() ? Array.from({ length: kept() }, (_, index) => index) : [],
  )
  const decks = createMemo(() => lists()?.own ?? [])
  const t = homeText[props.lang]
  return (
    <div className="home-list" data-home-frame="own-slides">
      {ghosts().length > 0 ? (
        <section className="home-own" aria-hidden="true">
          <div className="home-list-head">
            <h2>{t.ownHeading}</h2>
            <span className="see-all">{t.seeAll}</span>
          </div>
          <ul className="deck-grid deck-grid-4 home-loading">
            {ghosts().map((index) => (
              <li key={index} className="deck-card">
                <span className="card-title">
                  <span className="deck-cover"></span>
                  <span className="deck-name">&nbsp;</span>
                </span>
                <p className="card-meta">
                  <span className="status-chip">&nbsp;</span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : decks().length === 0 ? null : (
        <section className="home-own">
          <div className="home-list-head">
            <h2 id="own-slides">{t.ownHeading}</h2>
            <a className="see-all" href="/slides">
              {t.seeAll}
            </a>
          </div>
          <ul className="deck-grid deck-grid-4" aria-labelledby="own-slides">
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
                  {deck.isPublic ? (
                    <span className="status-chip status-public">
                      {t.public}
                    </span>
                  ) : (
                    <span className="status-chip status-draft">
                      {t.authorOnly}
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
