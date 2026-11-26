'use client'

import { createSignal } from '@barefootjs/client'
import {
  followPromptKind,
  followRequest,
  type FollowKind,
} from '../src/site/home-follow'
import { HOME_SIGN_IN_PATH } from '../src/site/home-shape'
import type {
  DiscoverCommunity,
  DiscoverPerson,
} from '../src/site/home-discover'
import { homeText } from '../src/site/home-text'
import type { Lang } from '../src/site/i18n'
import type { CarouselKind } from '../src/site/home-timeline'

interface HomeCarouselProps {
  lang: Lang
  kind: CarouselKind
  signedIn: boolean
  /** The people of the "people" carousel. */
  people?: readonly DiscoverPerson[]
  /** The communities of the "communities" carousel. */
  communities?: readonly DiscoverCommunity[]
  /** Called after a follow or an unfollow was saved (F44-AC26). */
  onFollowChange?: () => void
}

/** The id of a carousel's track, which its arrows slide. */
const trackId = (kind: CarouselKind) => `home-carousel-${kind}`

/** Slides a carousel's track by most of its width, to either side. */
const slide = (kind: CarouselKind, by: number) => {
  const track = document.getElementById(trackId(kind))
  if (!track) return
  track.scrollBy({ left: by * track.clientWidth * 0.8, behavior: 'smooth' })
}

/**
 * One carousel of the timeline (F44-AC15): the people who registered most
 * recently, or the communities made most recently, each with a follow
 * button. A card carries a name and what leads to its page, and nothing that
 * counts (F44-AC19, F44-AC20). The track slides sideways; the arrows are
 * for wider screens (F44-AC23).
 */
export function HomeCarousel(props: HomeCarouselProps) {
  // The keys (`kind:handle`) of the cards whose button has followed, and the
  // key of the one being sent. A card's button is drawn here, not in a
  // component of its own: a component inside a loop is not hydrated.
  const [followed, setFollowed] = createSignal<string[]>([])
  const [pending, setPending] = createSignal<string | null>(null)
  const t = homeText[props.lang]
  const press = async (kind: FollowKind, handle: string) => {
    const key = `${kind}:${handle}`
    if (pending() !== null) return
    setPending(key)
    const request = followRequest(kind, handle, followed().includes(key))
    try {
      const response = await fetch(request.path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams(request.fields),
      })
      if (response.ok) {
        const result = (await response.json()) as { following?: boolean }
        setFollowed(
          result.following === true
            ? [...followed().filter((k) => k !== key), key]
            : followed().filter((k) => k !== key),
        )
        props.onFollowChange?.()
      }
    } finally {
      setPending(null)
    }
  }
  const heading =
    props.kind === 'people' ? t.carouselPeople : t.carouselCommunities
  return (
    <section
      className="timeline-carousel-body"
      aria-labelledby={`${trackId(props.kind)}-title`}
    >
      <div className="carousel-head">
        <h2 className="carousel-title" id={`${trackId(props.kind)}-title`}>
          {heading}
        </h2>
        <button
          type="button"
          className="icon-link"
          aria-label={t.carouselPrev}
          onClick={() => slide(props.kind, -1)}
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
              <path d="M15 6l-6 6 6 6"></path>
            </svg>
          </span>
        </button>
        <button
          type="button"
          className="icon-link"
          aria-label={t.carouselNext}
          onClick={() => slide(props.kind, 1)}
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
              <path d="M9 6l6 6-6 6"></path>
            </svg>
          </span>
        </button>
      </div>
      {props.kind === 'people' ? (
        <ul className="carousel-track" id={trackId('people')}>
          {(props.people ?? []).map((person) => (
            <li key={person.handle} className="carousel-card">
              <div className="carousel-card-body">
                <a className="carousel-card-link" href={person.href}>
                  <span
                    className="carousel-face carousel-face-person"
                    aria-hidden="true"
                  >
                    {person.initial}
                    {person.avatarUrl ? (
                      <img
                        data-cover
                        src={person.avatarUrl}
                        alt=""
                        loading="lazy"
                        referrerpolicy="no-referrer"
                      />
                    ) : null}
                  </span>
                  <span className="carousel-names">
                    <span className="carousel-name">{person.name}</span>
                    <span className="carousel-sub">@{person.handle}</span>
                  </span>
                </a>
                {props.signedIn ? (
                  <span className="follow-form">
                    <button
                      type="button"
                      className="button-secondary"
                      aria-label={
                        followed().includes('person:' + person.handle)
                          ? t.unfollowOf(`@${person.handle}`)
                          : t.followOf(`@${person.handle}`)
                      }
                      aria-pressed={
                        followed().includes('person:' + person.handle)
                          ? 'true'
                          : 'false'
                      }
                      disabled={pending() !== null}
                      onClick={() => press('person', person.handle)}
                    >
                      {followed().includes('person:' + person.handle)
                        ? t.following
                        : t.follow}
                    </button>
                  </span>
                ) : (
                  <span className="follow-form">
                    <a
                      className="button-secondary"
                      href={HOME_SIGN_IN_PATH}
                      data-login-prompt={followPromptKind('person')}
                      aria-haspopup="dialog"
                      aria-label={t.followOf(`@${person.handle}`)}
                    >
                      {t.follow}
                    </a>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="carousel-track" id={trackId('communities')}>
          {(props.communities ?? []).map((community) => (
            <li
              key={community.handle}
              className="carousel-card carousel-card-community"
            >
              <div className="carousel-card-body">
                <a className="carousel-card-link" href={community.href}>
                  {community.logo.kind === 'image' ? (
                    <img
                      className="carousel-face carousel-face-logo"
                      src={community.logo.url}
                      alt=""
                      width="48"
                      height="48"
                    />
                  ) : (
                    <span
                      className={`carousel-face carousel-face-logo ${community.logo.className}`}
                      aria-hidden="true"
                    >
                      {community.logo.letter}
                    </span>
                  )}
                  <span className="carousel-names">
                    <span className="carousel-name">{community.name}</span>
                  </span>
                </a>
                <p className="carousel-description">{community.description}</p>
                {props.signedIn ? (
                  <span className="follow-form">
                    <button
                      type="button"
                      className="button-secondary"
                      aria-label={
                        followed().includes('community:' + community.handle)
                          ? t.unfollowOf(community.name)
                          : t.followOf(community.name)
                      }
                      aria-pressed={
                        followed().includes('community:' + community.handle)
                          ? 'true'
                          : 'false'
                      }
                      disabled={pending() !== null}
                      onClick={() => press('community', community.handle)}
                    >
                      {followed().includes('community:' + community.handle)
                        ? t.following
                        : t.follow}
                    </button>
                  </span>
                ) : (
                  <span className="follow-form">
                    <a
                      className="button-secondary"
                      href={HOME_SIGN_IN_PATH}
                      data-login-prompt={followPromptKind('community')}
                      aria-haspopup="dialog"
                      aria-label={t.followOf(community.name)}
                    >
                      {t.follow}
                    </a>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
