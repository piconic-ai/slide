import { html } from 'hono/html'
import { initialOf } from '../follows/people'
import type { Handle } from '../share/handle'
import {
  peoplePath,
  profilePath,
  type CitationList,
  type PeopleList,
} from '../share/path'
import { messages, type Lang } from '../site/i18n'
import { citationListName, citedTab, citingTab } from './citation-frames'
import { websiteLabel } from './profile-lines'
import type { StoredProfile } from './store'

const text = messages({
  ja: {
    location: '場所',
    website: 'Web サイト',
    links: 'SNS',
    tabs: 'プロフィールの切り替え',
    slides: 'スライド',
    following: 'フォロー中',
    followers: 'フォロワー',
  },
  en: {
    location: 'Location',
    website: 'Website',
    links: 'Social',
    tabs: 'Profile sections',
    slides: 'Slides',
    following: 'Following',
    followers: 'Followers',
  },
})

/** A link the author wrote, to a place outside the service. */
const outsideLink = (address: string) =>
  html`<a
    class="tap-area"
    href="${address}"
    rel="nofollow noopener noreferrer ugc"
    >${websiteLabel(address)}</a
  >`

/**
 * Who an author is, as they wrote it: picture, name and where to find them.
 * Without a profile, only the handle.
 */
export function profileCard(
  handle: string,
  stored: StoredProfile | null,
  lang: Lang,
  action: ReturnType<typeof html> | '' = '',
) {
  const t = text[lang]
  // Until a name is chosen, the handle stands in for the name.
  const profile: StoredProfile = stored ?? {
    name: handle,
    avatarUrl: null,
    location: null,
    website: null,
    links: [],
    bio: null,
    useGravatar: true,
  }
  const name = html`<h1>${stored?.name ?? `@${handle}`}</h1>`
  const portrait = profile?.avatarUrl
    ? html`<img
        class="portrait"
        src="${profile.avatarUrl}"
        alt=""
        width="96"
        height="96"
        referrerpolicy="no-referrer"
      />`
    : html`<span class="portrait portrait-initial" aria-hidden="true"
        >${initialOf(profile.name)}</span
      >`
  const handleLine = html`<p class="card-meta">@${handle}</p>`
  // Picture on the left, the name and what follows it beside it, the button
  // last: at the right on a wide screen, under the facts on a narrow one.
  return html`<div class="profile-head">
    ${portrait}
    <div class="profile-body">
      ${name}${handleLine}
      ${profile.bio ? html`<p class="profile-bio">${profile.bio}</p>` : ''}
      <ul class="facts">
        ${
          profile.location
            ? html`<li>
                <span class="fact-name">${t.location}</span> ${profile.location}
              </li>`
            : ''
        }
        ${
          profile.website
            ? html`<li>
                <span class="fact-name">${t.website}</span>
                ${outsideLink(profile.website)}
              </li>`
            : ''
        }
        ${
          profile.links.length > 0
            ? html`<li>
                <span class="fact-name">${t.links}</span>
                ${profile.links.map((link) => outsideLink(link))}
              </li>`
            : ''
        }
      </ul>
    </div>
    ${action ? html`<div class="profile-action">${action}</div>` : ''}
  </div>`
}

/** The part of a profile that is open: its slides or one of its lists. */
export type ProfileTab = 'slides' | PeopleList | CitationList

/** How many of each a profile has, as the reader of the page may see them. */
export type ProfileCounts = Readonly<Record<ProfileTab, number>>

/** The name of a profile's part, for its tab and the page's title. */
export const profileTabName = (tab: ProfileTab, lang: Lang) =>
  tab === 'citing' || tab === 'cited'
    ? citationListName(tab, lang)
    : text[lang][tab]

/**
 * The switch between a profile's slides, the people its author follows,
 * their followers, the slides they cited and the slides that cited them,
 * each with its count.
 */
export function profileTabs(
  handle: Handle,
  counts: ProfileCounts,
  current: ProfileTab,
  lang: Lang,
) {
  const t = text[lang]
  const tab = (name: 'slides' | PeopleList) =>
    html`<a
      href="${name === 'slides' ? profilePath(handle) : peoplePath(handle, name)}"
      ${name === current ? html`aria-current="page"` : ''}
      >${t[name]} <span class="count">${counts[name]}</span></a
    >`
  return html`<nav class="profile-tabs" aria-label="${t.tabs}">
    ${tab('slides')} ${tab('following')} ${tab('followers')}
    ${citingTab(handle, counts.citing, current === 'citing', lang)}
    ${citedTab(handle, counts.cited, current === 'cited', lang)}
  </nav>`
}
