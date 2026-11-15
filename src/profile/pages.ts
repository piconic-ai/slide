import { html } from 'hono/html'
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
  },
  en: {
    location: 'Location',
    website: 'Website',
    sponsor: 'Sponsor on GitHub',
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
) {
  const t = text[lang]
  if (!profile) return html`<h1>@${handle}</h1>`
  return html`${
      profile.avatarUrl
        ? html`<img
            class="portrait"
            src="${profile.avatarUrl}"
            alt=""
            width="96"
            height="96"
            referrerpolicy="no-referrer"
          />`
        : ''
    }
    <h1>${profile.name ?? `@${handle}`}</h1>
    ${profile.name ? html`<p class="card-meta">@${handle}</p>` : ''}
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
