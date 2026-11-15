import { html } from 'hono/html'
import { accountDeletion, logoutForm } from '../decks/pages'
import { messages, type Lang } from './i18n'

const text = messages({
  ja: {
    title: '設定',
    profile: 'プロフィール設定',
    handle: 'ハンドル',
    handleNote:
      'ハンドルは GitHub のユーザー名から決まり、共有 URL とプロフィールの URL に使います。ここでは変更できません。',
    noHandle: 'ハンドルはまだ決まっていません。ログインし直すと決まります。',
    openProfile: 'プロフィールを開く',
    account: 'アカウント設定',
    signedInAs: (login: string) => `GitHub の ${login} としてログイン中`,
  },
  en: {
    title: 'Settings',
    profile: 'Profile',
    handle: 'Handle',
    handleNote:
      'Your handle comes from your GitHub username and is used in share links and your profile URL. It cannot be changed here.',
    noHandle: 'You have no handle yet. Sign in again to get one.',
    openProfile: 'Open your profile',
    account: 'Account',
    signedInAs: (login: string) => `Signed in as ${login} on GitHub`,
  },
})

export const settingsTitle = (lang: Lang) => text[lang].title

/**
 * The author's settings: what their profile shows, then the account itself,
 * ending with the way to leave the service.
 */
export const settingsBody = (
  owner: Readonly<{ login: string; handle: string | null }>,
  lang: Lang,
) => {
  const t = text[lang]
  return html`<h1>${t.title}</h1>
    <section id="profile">
      <h2>${t.profile}</h2>
      ${
        owner.handle
          ? html`<p>${t.handle}: <code>@${owner.handle}</code></p>
              <p>${t.handleNote}</p>
              <p><a href="/@${owner.handle}">${t.openProfile}</a></p>`
          : html`<p>${t.noHandle}</p>`
      }
    </section>
    <section id="account">
      <h2>${t.account}</h2>
      <p>${t.signedInAs(owner.login)}</p>
      ${logoutForm(lang)} ${accountDeletion(owner.login, lang)}
    </section>`
}
