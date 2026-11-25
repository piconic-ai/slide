'use client'

import { createMemo, createQuery, http } from '@barefootjs/client'
import { citedCountText } from '../src/citations/cited-count'
import { dayFormats } from '../src/share/dates'
import type { HomeCommunityLists } from '../src/site/home-communities'
import { FOLLOWED_COMMUNITY_TALKS_PATH } from '../src/site/home-shape'
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
 * know its visitor, so the list is fetched after it loads. The section
 * stands only once slides came: a visitor who is not signed in, follows no
 * community, or whose communities have no slide gets nothing (F31-AC6).
 */
export function HomeCommunities(props: HomeCommunitiesProps) {
  const [lists] = createQuery(
    () => http.get<HomeCommunityLists | null>('/api/home/communities'),
    { initial: props.lists },
  )
  const decks = createMemo(() => lists()?.talks ?? [])
  const t = homeText[props.lang]
  return (
    <div data-home-frame="communities">
      {decks().length === 0 ? null : (
        <section className="home-communities">
          <div className="home-section-head">
            <h2 id="communities-new">{t.communitiesHeading}</h2>
            <a href={FOLLOWED_COMMUNITY_TALKS_PATH}>{t.seeAll}</a>
          </div>
          <ul
            className="deck-grid deck-grid-4"
            aria-labelledby="communities-new"
          >
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
                  {citedCountText(deck.citedBy, props.lang) === null ? null : (
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
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
