import { html } from 'hono/html'
import type { EventCommunityView } from '../communities/community'
import { logoOf } from '../communities/logo'
import { communityStyle } from '../communities/community-style'
import { citationCardGrid, type CitationCard } from '../citations/cards'
import { coverUrl } from '../share/cover'
import type { EventCommunity } from '../events/deck-event'
import { groupPageOfHosts } from '../events/event-url'
import { linkCheckPrompt, linkCheckTrigger } from '../share/link-check'
import { profilePath, sharePath } from '../share/path'
import { coverOf, type Cover } from '../site/cover-pattern'
import { messages, type Lang } from '../site/i18n'
import { headingOf, sourceLinkTextOf, type NamedEvent } from './link-heading'
import type { EventTalk } from './link-page-store'

const text = messages({
  ja: {
    cover: (name: string) => `${name} のカバー画像`,
    talks: 'スライド',
    count: (count: number) => `${count} 本`,
    noCommunity: 'このグループのコミュニティはまだありません',
    create: '作る',
  },
  en: {
    cover: (name: string) => `Cover image of ${name}`,
    talks: 'Slides',
    count: (count: number) => `${count}`,
    noCommunity: 'This group has no community yet',
    create: 'Create',
  },
})

/** Where a community is made, with the group's page already filled in. */
export const NEW_COMMUNITY_PATH = '/communities/new'

/** What the page of the links to one address shows. */
export type LinkPageView = Readonly<{
  /** What the heading is made of: an event, or a link that is none. */
  event: NamedEvent
  /** Where the page leads readers: the address's own page (F45-AC42). */
  source: string
  talks: readonly EventTalk[]
  /** The hosts the links of the talks were written with. */
  linkHosts: ReadonlySet<string>
  /** The community the link is in, with its cover; null for none (F45-AC17). */
  community: (EventCommunityView & EventCommunity & { cover: Cover }) | null
  /** Where covers load from; without one the cards show the names alone. */
  contentBase: URL | null
}>

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
const communityPrompt = (view: LinkPageView, lang: Lang) => {
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

/** The title of the page: its heading. */
export const linkPageTitle = (event: NamedEvent) => headingOf(event)

/**
 * The cover, logo and name of the community the link is in, the name
 * leading to its page (F45-AC17); nothing for a link in none.
 */
const communityHead = (view: LinkPageView, lang: Lang) =>
  view.community === null
    ? ''
    : html`${coverOf(view.community.cover, text[lang].cover(view.community.name))}
        <p class="event-community">
          ${logoOf(view.community, 28)}
          <a href="${view.community.href}">${view.community.name}</a>
        </p>`

/**
 * The page of the links to one address: the community it is in, the
 * heading, the way to the address's own page, which is never fetched and
 * which the reader checks before following (F45-AC16, F45-AC30), then the
 * slides as cards. No date or place: the service does not know them.
 */
export function linkPageBody(view: LinkPageView, lang: Lang) {
  const t = text[lang]
  // The logo's own styles come with it, as on the community's pages.
  return html`${view.community ? communityStyle : ''}
    <div class="event-page">
      ${communityHead(view, lang)}
      <header class="event-head">
        <h1>${headingOf(view.event)}</h1>
        <p>
          <a
            href="${view.source}"
            rel="noopener nofollow ugc"
            ${linkCheckTrigger()}
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
    </div>
    ${linkCheckPrompt(lang)}`
}
