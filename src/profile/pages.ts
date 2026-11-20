import { html } from 'hono/html'
import { initialOf } from '../follows/people'
import type { Handle } from '../share/handle'
import { peoplePath, profilePath, type PeopleList } from '../share/path'
import { messages, type Lang } from '../site/i18n'
import {
  githubUrl,
  sponsorsUrl,
  websiteLabel,
  type Profile,
} from './github-profile'

const text = messages({
  ja: {
    location: '場所',
    website: 'Web サイト',
    sponsor: 'GitHub Sponsors で応援する',
    tabs: 'プロフィールの切り替え',
    slides: 'スライド',
    following: 'フォロー中',
    followers: 'フォロワー',
  },
  en: {
    location: 'Location',
    website: 'Website',
    sponsor: 'Sponsor on GitHub',
    tabs: 'Profile sections',
    slides: 'Slides',
    following: 'Following',
    followers: 'Followers',
  },
})

/**
 * Who an author is, as their GitHub profile says: picture, name, and where
 * to find and support them. Before the first sync, only the handle.
 */
export function profileCard(
  handle: string,
  profile: (Profile & Readonly<{ hasSponsors: boolean }>) | null,
  lang: Lang,
  action: ReturnType<typeof html> | '' = '',
) {
  const t = text[lang]
  const name = html`<h1>${profile?.name ?? `@${handle}`}</h1>`
  // Always wrapped, so the name sits at the same height with or without a button.
  const heading = html`<div class="profile-heading">${name} ${action}</div>`
  if (!profile) return heading
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
        >${initialOf(profile.name ?? handle)}</span
      >`
  const handleLine = profile?.name
    ? html`<p class="card-meta">@${handle}</p>`
    : ''
  const identity = html`${portrait}${heading}${handleLine}`
  return html`${identity}
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
              <a href="${profile.website}" rel="nofollow noopener"
                >${websiteLabel(profile.website)}</a
              >
            </li>`
          : ''
      }
      <li>
        <span class="fact-name">GitHub</span>
        <a href="${githubUrl(profile.login)}" rel="noopener"
          >@${profile.login}</a
        >
      </li>
      ${
        profile.hasSponsors
          ? html`<li>
              <a href="${sponsorsUrl(profile.login)}" rel="noopener"
                >${t.sponsor}</a
              >
            </li>`
          : ''
      }
    </ul>`
}

/** The part of a profile that is open: its slides, or a list of people. */
export type ProfileTab = 'slides' | PeopleList

/** How many of each a profile has, as the reader of the page may see them. */
export type ProfileCounts = Readonly<Record<ProfileTab, number>>

/** The name of a profile's part, for its tab and the page's title. */
export const profileTabName = (tab: ProfileTab, lang: Lang) => text[lang][tab]

/**
 * The switch between a profile's slides, the people its author follows and
 * their followers, each with its count.
 */
export function profileTabs(
  handle: Handle,
  counts: ProfileCounts,
  current: ProfileTab,
  lang: Lang,
) {
  const t = text[lang]
  const tab = (name: ProfileTab) =>
    html`<a
      href="${name === 'slides' ? profilePath(handle) : peoplePath(handle, name)}"
      ${name === current ? html`aria-current="page"` : ''}
      >${t[name]} <span class="count">${counts[name]}</span></a
    >`
  return html`<nav class="profile-tabs" aria-label="${t.tabs}">
    ${tab('slides')} ${tab('following')} ${tab('followers')}
  </nav>`
}
