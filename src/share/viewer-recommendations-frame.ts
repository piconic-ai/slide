import { html } from 'hono/html'
import { citationCardGrid, type CitationCard } from '../citations/cards'
import { communityHref } from '../communities/community'
import { eventNameOf } from '../links/link-heading'
import { messages, type Lang } from '../site/i18n'
import { eventHref } from './viewer-events-frame'
import type { ViewerTalks } from './viewer-talks'

const text = messages({
  ja: {
    sameEvent: (event: string) => `${event} のほかの発表`,
    sameCommunity: (community: string) => `${community} のほかのイベントの発表`,
    viewEvent: 'イベントを見る',
    viewCommunity: 'コミュニティを見る',
  },
  en: {
    sameEvent: (event: string) => `Other talks at ${event}`,
    sameCommunity: (community: string) =>
      `Talks at other events of ${community}`,
    viewEvent: 'View the event',
    viewCommunity: 'View the community',
  },
})

/**
 * One section: its heading with the way to the whole (F24-AC48), then the
 * cards. With no card it holds nothing at all, heading included
 * (F24-AC44). Its place stays, so /share.js can put a fresh one there
 * after a reader mutes or releases an author, as it does the citations.
 */
const section = (
  name: 'same-event' | 'same-community',
  head: Readonly<{ heading: string; href: string; label: string }> | null,
  cards: readonly CitationCard[],
  lang: Lang,
) =>
  head && cards.length
    ? html`<div data-reader-lists="${name}">
        <section class="viewer-talks">
          <div class="viewer-talks-head">
            <h2 id="${name}">${head.heading}</h2>
            <a href="${head.href}">${head.label}</a>
          </div>
          ${citationCardGrid(cards, lang, name, 4)}
        </section>
      </div>`
    : html`<div data-reader-lists="${name}"></div>`

/**
 * Where the viewer shows, under everything else, the other talks of the
 * same event (D-56 decides whether this section stands).
 */
export const viewerSameEventFrame = (talks: ViewerTalks, lang: Lang) => {
  const { event } = talks
  const t = text[lang]
  return section(
    'same-event',
    event && {
      heading: t.sameEvent(eventNameOf(event, lang)),
      href: eventHref(event),
      label: t.viewEvent,
    },
    talks.sameEvent,
    lang,
  )
}

/**
 * Where the viewer shows, under the same event's section, the talks of the
 * same community's other events, and, when the event has too few talks for
 * a section of its own, the event's talks first.
 */
export const viewerSameCommunityFrame = (talks: ViewerTalks, lang: Lang) => {
  const community = talks.event?.community ?? null
  const t = text[lang]
  return section(
    'same-community',
    community && {
      heading: t.sameCommunity(community.name),
      href: communityHref(community.handle),
      label: t.viewCommunity,
    },
    talks.sameCommunity,
    lang,
  )
}
