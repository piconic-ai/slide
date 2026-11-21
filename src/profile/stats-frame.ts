import { html } from 'hono/html'
import type { Handle } from '../share/handle'
import { peoplePath } from '../share/path'
import { messages, type Lang } from '../site/i18n'
import { citedStat, citingStat } from './citation-frames'
import type { ProfileCounts } from './pages'

const text = messages({
  ja: {
    label: 'フォローと引用の数',
    following: 'フォロー中',
    followers: 'フォロワー',
  },
  en: {
    label: 'Follows and citations',
    following: 'Following',
    followers: 'Followers',
  },
})

/** One number of the profile's head, as a link to its list. */
export const profileStat = (href: string, count: number, label: string) =>
  html`<li>
    <a class="profile-stat" href="${href}"
      ><span class="stat-count">${count}</span
      ><span class="stat-label">${label}</span></a
    >
  </li>`

/**
 * The four numbers of a profile's head, in this order: following, followers,
 * citing, cited. The last two are frames of their own (see
 * citation-frames.ts).
 */
export const profileStatsFrame = (
  handle: Handle,
  counts: ProfileCounts,
  lang: Lang,
) => {
  const t = text[lang]
  return html`<ul class="profile-stats" aria-label="${t.label}">
    ${profileStat(peoplePath(handle, 'following'), counts.following, t.following)}
    ${profileStat(peoplePath(handle, 'followers'), counts.followers, t.followers)}
    ${citingStat(handle, counts.citing, lang)}
    ${citedStat(handle, counts.cited, lang)}
  </ul>`
}
