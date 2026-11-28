import { html } from 'hono/html'
import {
  communityHref,
  type EventCommunityView,
} from '../communities/community'
import { logoOf } from '../communities/logo'
import { eventPagePath } from '../links/link-address'
import { headingOf, type NamedEvent } from '../links/link-heading'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: { label: '発表したイベント' },
  en: { label: 'Events presented at' },
})

/** An event the slides were presented at, with the community it is shown with. */
export type ViewerEvent = NamedEvent &
  Readonly<{
    id: number
    /** Its address (`events.url`), which its page of links is found by. */
    url: string
    community: EventCommunityView | null
  }>

/** Where an event's page is: the page of links of its address (F45). */
export const eventHref = (event: Pick<ViewerEvent, 'url'>) =>
  eventPagePath(event.url)

/** "<event> で発表" in Japanese, "Presented at <event>" in English. */
const presentedAt = (event: ViewerEvent, lang: Lang) => {
  const link = html`<a class="viewer-event-name" href="${eventHref(event)}"
    >${headingOf(event)}</a
  >`
  return lang === 'ja'
    ? html`${link}<span>で発表</span>`
    : html`<span>Presented at</span>${link}`
}

/** One event's line: the logo, the event, "presented at", the community. */
function eventLine(event: ViewerEvent, lang: Lang) {
  const { community } = event
  if (community === null)
    return html`<li class="viewer-event">${presentedAt(event, lang)}</li>`
  return html`<li class="viewer-event">
    ${logoOf(community, 28)} ${presentedAt(event, lang)}
    <span class="viewer-event-dot" aria-hidden="true">·</span>
    <a href="${communityHref(community.handle)}">${community.name}</a>
  </li>`
}

/**
 * Where the viewer shows, under the title, the events the slides were
 * presented at, in the order their related links were added (F24-AC39,
 * F24-AC40): the community's logo, the event's name to its page,
 * "presented at" and the community's name to its page. An event in no
 * community has neither logo nor community. With no event it holds nothing
 * at all.
 */
export const viewerEventsFrame = (events: readonly ViewerEvent[], lang: Lang) =>
  events.length === 0
    ? ''
    : html`<ul class="viewer-events" aria-label="${text[lang].label}">
        ${events.map((event) => eventLine(event, lang))}
      </ul>`
