'use client'

import { citedCountText } from '../src/citations/cited-count'
import type { Lang } from '../src/site/i18n'
import type { DeckSource } from '../src/site/home-timeline'
import { homeText } from '../src/site/home-text'

interface DeckMetaProps {
  lang: Lang
  authorHref: string
  handle: string
  /** The author's picture; the initial shows under it and when it fails. */
  authorAvatarUrl: string | null
  /** Set on the "following" tab: why the slide is there. */
  source?: DeckSource
  /** How many decks cite the slide; 0 shows nothing. */
  citedBy: number
}

/** The line under a card's cover: who made the slide, and what marks it. */
export function DeckMeta(props: DeckMetaProps) {
  const t = homeText[props.lang]
  const cited = citedCountText(props.citedBy, props.lang)
  return (
    <p className="card-meta">
      <a className="card-author" href={props.authorHref}>
        <span className="card-author-face" aria-hidden="true">
          {props.handle.slice(0, 1).toUpperCase()}
          {props.authorAvatarUrl ? (
            <img
              data-cover
              src={props.authorAvatarUrl}
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
            />
          ) : null}
        </span>
        @{props.handle}
      </a>
      {props.source?.kind === 'person' ? (
        <span className="source-label">{t.followedAuthor}</span>
      ) : null}
      {cited === null ? null : <span className="card-cited">{cited}</span>}
    </p>
  )
}
