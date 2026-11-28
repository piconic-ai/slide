import { html } from 'hono/html'
import { eventNameOf } from '../events/event-name'
import { eventPagePath } from '../links/link-address'
import { websiteLabel } from '../profile/profile-lines'
import { coverUrl } from '../share/cover'
import { dayFormats } from '../share/dates'
import type { Handle } from '../share/handle'
import { profilePath, sharePath } from '../share/path'
import { coverOf } from '../site/cover-pattern'
import { deckCard } from '../site/deck-card'
import { messages, type Lang } from '../site/i18n'
import {
  communityCoverOf,
  type Community,
  type CommunityEvent,
  type CommunityTalk,
} from './community'
import { communityStyle } from './community-style'
import { logoOf } from './logo'

/** The parts of a community's page, each its own tab. */
export const COMMUNITY_TABS = ['events', 'slides', 'followers'] as const
export type CommunityTab = (typeof COMMUNITY_TABS)[number]

/** How many slides one event's row shows before "n more" (F30-AC19). */
export const CAROUSEL_TALKS = 6

const text = messages({
  ja: {
    cover: (name: string) => `${name} のカバー画像`,
    edit: 'コミュニティを編集',
    tabs: 'コミュニティの一覧',
    events: 'イベント',
    slides: 'スライド',
    followers: 'フォロワー',
    talks: (count: number) => `スライド ${count} 本`,
    more: (count: number) => `ほか ${count} 本`,
    region: (name: string) => `${name} のスライド`,
    previous: '前のスライド',
    next: '次のスライド',
    noEvents: 'まだイベントの発表はありません。',
    noSlides: 'まだスライドはありません。',
    luma: 'Luma のカレンダー',
  },
  en: {
    cover: (name: string) => `Cover image of ${name}`,
    edit: 'Edit community',
    tabs: 'Community lists',
    events: 'Events',
    slides: 'Slides',
    followers: 'Followers',
    talks: (count: number) => `${count} ${count === 1 ? 'slide' : 'slides'}`,
    more: (count: number) => `${count} more`,
    region: (name: string) => `Slides of ${name}`,
    previous: 'Previous slides',
    next: 'Next slides',
    noEvents: 'No talks at its events yet.',
    noSlides: 'No slides yet.',
    luma: 'Luma calendar',
  },
})

/** The path of a tab of a community's page. */
export const communityTabPath = (handle: Handle, tab: CommunityTab) =>
  tab === 'events' ? profilePath(handle) : `${profilePath(handle)}/${tab}`

/** The path of a community's editing page. */
export const communityEditPath = (handle: Handle) =>
  `${profilePath(handle)}/edit`

/** A community's cover: the uploaded one, or the default pattern (D-46). */
export const communityCover = (community: Community, lang: Lang) =>
  coverOf(communityCoverOf(community), text[lang].cover(community.name))

const outside = (href: string, label: string) =>
  html`<a href="${href}" rel="nofollow noopener noreferrer ugc">${label}</a>`

/** Where the community is elsewhere: its links, then its other links. */
function places(community: Community, lang: Lang) {
  const links = community.links.map((link) =>
    link.host === null
      ? outside(link.url, text[lang].luma)
      : outside(link.url, link.host),
  )
  const sites = community.sites.map((site) => outside(site, websiteLabel(site)))
  return html`<ul class="community-places">
    <li>@${community.handle}</li>
    ${[...links, ...sites].map((link) => html`<li>${link}</li>`)}
  </ul>`
}

/** What the reader may do, beside the head. */
export type CommunityReader = Readonly<{
  admin: boolean
  /** The place of "follow", which the work on following fills. */
  follow: ReturnType<typeof html> | string
}>

/**
 * The head of a community's page (F30-AC18): its logo, name, description
 * (plain text, its addresses not made links), handle and links, then "edit"
 * for its admins and the place of "follow". No count stands here.
 */
function communityHead(
  community: Community,
  reader: CommunityReader,
  lang: Lang,
) {
  const actions = [
    reader.admin
      ? html`<a
          class="button-secondary"
          href="${communityEditPath(community.handle)}"
          >${text[lang].edit}</a
        >`
      : '',
    reader.follow,
  ].filter((action) => action !== '')
  return html`<div class="profile-head community-head">
    ${logoOf(community, 96)}
    <div class="profile-body">
      <h1>${community.name}</h1>
      ${
        community.description
          ? html`<p class="community-description">${community.description}</p>`
          : ''
      }
      ${places(community, lang)}
    </div>
    ${
      actions.length > 0
        ? html`<div class="profile-action community-actions">${actions}</div>`
        : ''
    }
  </div>`
}

/** How many of each a community has, as the reader may see them. */
export type CommunityCounts = Readonly<Record<CommunityTab, number>>

function communityTabs(
  handle: Handle,
  counts: CommunityCounts,
  current: CommunityTab,
  lang: Lang,
) {
  const t = text[lang]
  return html`<nav class="profile-tabs" aria-label="${t.tabs}">
    ${COMMUNITY_TABS.map(
      (tab) =>
        html`<a
          href="${communityTabPath(handle, tab)}"
          ${tab === current ? html`aria-current="page"` : ''}
          >${t[tab]} <span class="count">${counts[tab]}</span></a
        >`,
    )}
  </nav>`
}

const talkCard = (talk: CommunityTalk, contentBase: URL | null, lang: Lang) => {
  const name = talk.title ?? talk.slug
  const at = new Date(talk.publishedAt * 1000)
  return deckCard(
    {
      name,
      href: sharePath(talk.handle, talk.slug),
      coverUrl: contentBase
        ? coverUrl(contentBase, talk.deploymentId, talk.coverPath)
        : null,
    },
    html`<a href="${profilePath(talk.handle)}">@${talk.handle}</a> ·
      <time datetime="${at.toISOString()}"
        >${dayFormats[lang].format(at)}</time
      >`,
  )
}

/**
 * One event of the events tab (F30-AC19, F30-AC20): its name to its page of
 * links (F45), how many slides, and the slides sent sideways, up to
 * CAROUSEL_TALKS, then "n more" to that page. The buttons that send them stay hidden until the
 * page's script finds the row wider than its frame.
 */
function eventRow(event: CommunityEvent, contentBase: URL | null, lang: Lang) {
  const t = text[lang]
  const name = eventNameOf(event, lang)
  const href = eventPagePath(event.url)
  const shown = event.talks.slice(0, CAROUSEL_TALKS)
  const more = event.talks.length - shown.length
  const regionId = `community-event-${event.id}`
  return html`<section class="community-event">
    <div class="community-event-head">
      <div>
        <h2><a href="${href}">${name}</a></h2>
        <p class="community-event-count">${t.talks(event.talks.length)}</p>
      </div>
      <div class="carousel-buttons" data-carousel-buttons="${regionId}" hidden>
        <button
          type="button"
          data-carousel-step="-1"
          aria-controls="${regionId}"
          aria-label="${t.previous}"
        >
          ‹
        </button>
        <button
          type="button"
          data-carousel-step="1"
          aria-controls="${regionId}"
          aria-label="${t.next}"
        >
          ›
        </button>
      </div>
    </div>
    <div
      class="carousel"
      id="${regionId}"
      role="region"
      aria-label="${t.region(name)}"
      tabindex="0"
      data-carousel
    >
      <ul>
        ${shown.map((talk) => talkCard(talk, contentBase, lang))}
        ${
          more > 0
            ? html`<li class="carousel-more">
                <a href="${href}">${t.more(more)}</a>
              </li>`
            : ''
        }
      </ul>
    </div>
  </section>`
}

/** What the open tab of a community's page lists. */
export type CommunityTabView =
  | Readonly<{ kind: 'events'; events: readonly CommunityEvent[] }>
  | Readonly<{ kind: 'slides'; slides: readonly CommunityTalk[] }>
  /** The followers, which the work on following lists. */
  | Readonly<{ kind: 'followers'; list: ReturnType<typeof html> | string }>

function tabBody(view: CommunityTabView, contentBase: URL | null, lang: Lang) {
  const t = text[lang]
  switch (view.kind) {
    case 'events':
      return view.events.length === 0
        ? html`<p class="empty">${t.noEvents}</p>`
        : html`${view.events.map((event) => eventRow(event, contentBase, lang))}`
    case 'slides':
      return view.slides.length === 0
        ? html`<p class="empty">${t.noSlides}</p>`
        : html`<ul class="deck-grid deck-grid-4" aria-label="${t.slides}">
            ${view.slides.map((talk) => talkCard(talk, contentBase, lang))}
          </ul>`
    case 'followers':
      return view.list
  }
}

/** The title of a community's page: its name. */
export const communityPageTitle = (community: Community) => community.name

/**
 * A community's page (F30-AC18): its cover, its head, its tabs, and the
 * open tab's list.
 */
export function communityPageBody(
  input: Readonly<{
    community: Community
    reader: CommunityReader
    counts: CommunityCounts
    view: CommunityTabView
    contentBase: URL | null
  }>,
  lang: Lang,
) {
  return html`${communityStyle}
    <div class="community-page">
      ${communityCover(input.community, lang)}
      ${communityHead(input.community, input.reader, lang)}
      ${communityTabs(input.community.handle, input.counts, input.view.kind, lang)}
      ${tabBody(input.view, input.contentBase, lang)}
    </div>`
}
