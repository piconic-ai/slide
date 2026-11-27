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
  authorAvatarUrl: string
  /** Set on the "following" tab: why the slide is there. */
  source?: DeckSource
  /** How many decks cite the slide; 0 shows nothing. */
  citedBy: number
}

/**
 * The line under a card's cover: who made the slide, and what marks it.
 *
 * The marks are always in the line and hidden when they do not apply: this
 * component holds no conditional. A conditional here takes a slot id that a
 * conditional of the list row around it can also have, and BarefootJS 0.41
 * then draws the row's branch, the cover image at its full size, into this
 * line.
 */
export function DeckMeta(props: DeckMetaProps) {
  const t = homeText[props.lang]
  const cited = citedCountText(props.citedBy, props.lang)
  const followed = props.source?.kind === 'person'
  // Chosen here: a ternary among the children would be a conditional.
  const followedText = followed ? t.followedAuthor : ''
  return (
    <p className="card-meta">
      <a className="card-author" href={props.authorHref}>
        <span className="card-author-face" aria-hidden="true">
          {props.handle.slice(0, 1).toUpperCase()}
          <img
            data-cover
            src={props.authorAvatarUrl}
            alt=""
            loading="lazy"
            referrerpolicy="no-referrer"
          />
        </span>
        @{props.handle}
      </a>
      <span className="source-label" hidden={!followed}>
        {followedText}
      </span>
      <span className="card-cited" hidden={cited === null}>
        {cited ?? ''}
      </span>
    </p>
  )
}
