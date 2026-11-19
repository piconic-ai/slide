import { html } from 'hono/html'
import { messages, type Lang } from './i18n'
import { peopleList } from './settings-people'

const text = messages({
  ja: {
    heading: 'フォローしている人',
    none: 'フォローしている人はいません。',
    unfollow: {
      label: '解除',
      name: (handle: string) => `@${handle} のフォローを解除`,
    },
  },
  en: {
    heading: 'People you follow',
    none: 'You aren’t following anyone.',
    unfollow: {
      label: 'Unfollow',
      name: (handle: string) => `Unfollow @${handle}`,
    },
  },
})

/**
 * The people the author follows, each with the way to unfollow. It stays in
 * the settings until the profile lists them; the follow feature then takes
 * this frame out.
 */
export const settingsFollowingFrame = (
  following: readonly string[],
  lang: Lang,
) => {
  const t = text[lang]
  return html`<section class="panel" id="following">
    <h2>${t.heading}</h2>
    ${peopleList(following, '/follows', t.unfollow, t.none)}
  </section>`
}
