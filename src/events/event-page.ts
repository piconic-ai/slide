import { html } from 'hono/html'
import { citationCardGrid, type CitationCard } from '../citations/cards'
import { coverUrl } from '../share/cover'
import { profilePath, sharePath } from '../share/path'
import {
  colorOfNumber,
  coverPattern,
  type CommunityColor,
} from '../site/cover-pattern'
import { messages, type Lang } from '../site/i18n'
import type { EventCommunity } from './deck-event'
import { eventNameOf, sourceLinkTextOf } from './event-name'
import { groupPageOfHosts } from './event-url'
import type { EventTalk, StoredEvent } from './store'

const text = messages({
  ja: {
    cover: (name: string) => `${name} のカバー画像`,
    talks: '発表',
    count: (count: number) => `${count} 本`,
    noCommunity: 'このグループのコミュニティはまだありません',
    create: '作る',
  },
  en: {
    cover: (name: string) => `Cover image of ${name}`,
    talks: 'Talks',
    count: (count: number) => `${count}`,
    noCommunity: 'This group has no community yet',
    create: 'Create',
  },
})

/** Where a community is made, with the group's page already filled in. */
export const NEW_COMMUNITY_PATH = '/communities/new'

/**
 * The cover of an event: its community's (another piece of work fills it
 * in), or, for an event of none, the default pattern in the color its number
 * picks (D-49).
 */
export type EventCover =
  | Readonly<{ kind: 'pattern'; color: CommunityColor; seed: number }>
  | Readonly<{ kind: 'image'; url: string }>

/** The cover of an event that is in no community. */
export const defaultEventCover = (eventId: number): EventCover => ({
  kind: 'pattern',
  color: colorOfNumber(eventId),
  seed: eventId,
})

/** What the page of one event shows. */
export type EventPageView = Readonly<{
  event: StoredEvent
  talks: readonly EventTalk[]
  /** The hosts the links of the talks were written with. */
  linkHosts: ReadonlySet<string>
  community: EventCommunity | null
  cover: EventCover
  /** Where covers load from; without one the cards show the names alone. */
  contentBase: URL | null
}>

const coverOf = (cover: EventCover, label: string) =>
  cover.kind === 'pattern'
    ? coverPattern({ ...cover, label })
    : html`<img
        class="cover-image"
        src="${cover.url}"
        alt="${label}"
        referrerpolicy="no-referrer"
      />`

const cardOf = (talk: EventTalk, contentBase: URL | null): CitationCard => ({
  name: talk.title ?? talk.slug,
  href: sharePath(talk.handle, talk.slug),
  handle: talk.handle,
  authorHref: profilePath(talk.handle),
  publishedAt: talk.publishedAt,
  coverUrl: contentBase
    ? coverUrl(contentBase, talk.deploymentId, talk.coverPath)
    : null,
  citedBy: 0,
})

/**
 * For an event of a group with no community, the way to make one: only when
 * its links name one group.
 */
const communityPrompt = (view: EventPageView, lang: Lang) => {
  const group =
    view.community === null
      ? groupPageOfHosts(view.event.service, view.linkHosts)
      : null
  if (group === null) return ''
  const t = text[lang]
  return html`<p class="event-community-prompt">
    ${t.noCommunity}
    <a
      class="button-secondary"
      href="${NEW_COMMUNITY_PATH}?link=${encodeURIComponent(group)}"
      >${t.create}</a
    >
  </p>`
}

/** The title of the page of one event: its name. */
export const eventPageTitle = (event: StoredEvent, lang: Lang) =>
  eventNameOf(event, lang)

/**
 * The page of one event: its cover, its head (the community, the name and
 * the way to the event's own page, which is never fetched), then its talks
 * as cards. No date or place: the service does not know them.
 */
export function eventPageBody(view: EventPageView, lang: Lang) {
  const t = text[lang]
  const name = eventNameOf(view.event, lang)
  return html`<div class="event-page">
    ${coverOf(view.cover, t.cover(view.community?.name ?? name))}
    <header class="event-head">
      ${
        view.community
          ? html`<p class="event-community">
              <a href="${view.community.href}">${view.community.name}</a>
            </p>`
          : ''
      }
      <h1>${name}</h1>
      <p>
        <a href="${view.event.url}" rel="noopener nofollow ugc"
          >${sourceLinkTextOf(view.event, lang)}</a
        >
      </p>
      ${communityPrompt(view, lang)}
    </header>
    <section class="event-talks">
      <h2 id="event-talks">
        ${t.talks}
        <span class="event-talks-count">${t.count(view.talks.length)}</span>
      </h2>
      ${citationCardGrid(
        view.talks.map((talk) => cardOf(talk, view.contentBase)),
        lang,
        'event-talks',
      )}
    </section>
  </div>`
}
