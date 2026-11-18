import { html } from 'hono/html'
import { accountDeletion, logoutForm } from '../decks/pages'
import { messages, type Lang } from './i18n'
import { profileCard } from '../profile/pages'
import type { SyncedProfile } from '../profile/store'
import { dayFormats } from '../share/dates'

const text = messages({
  ja: {
    title: '設定',
    profile: 'プロフィール設定',
    handle: 'ハンドル',
    handleNote:
      'ハンドルは GitHub のユーザー名から決まり、共有 URL とプロフィールの URL に使います。ここでは変更できません。',
    noHandle:
      'ハンドルはまだ決まっていません。プロフィールと共有 URL は、ハンドルが決まると使えます。',
    openProfile: 'プロフィールを開く',
    synced:
      'プロフィールは GitHub の公開プロフィールから同期しています。直すときは、GitHub のプロフィールを直してから同期し直してください。',
    syncedOn: (day: string) => `最後の同期: ${day}`,
    notSynced: 'まだ同期していません。',
    sync: 'GitHub から同期し直す',
    muted: 'ミュートしている人',
    noneMuted: 'ミュートしている人はいません。',
    release: '解除',
    account: 'アカウント設定',
    signedInAs: (login: string) => `GitHub の ${login} としてログイン中`,
  },
  en: {
    title: 'Settings',
    profile: 'Profile',
    handle: 'Handle',
    handleNote:
      'Your handle comes from your GitHub username and is used in share links and your profile URL. It cannot be changed here.',
    noHandle: 'You have no handle yet. Your profile and share links need one.',
    openProfile: 'Open your profile',
    synced:
      'Your profile is synced from your public GitHub profile. To change it, edit your GitHub profile, then sync again.',
    syncedOn: (day: string) => `Last synced: ${day}`,
    notSynced: 'Not synced yet.',
    sync: 'Sync from GitHub again',
    muted: 'People you muted',
    noneMuted: 'You haven’t muted anyone.',
    release: 'Release',
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
  owner: Readonly<{
    login: string
    handle: string | null
    profile: SyncedProfile | null
    muted: readonly { handle: string }[]
  }>,
  lang: Lang,
) => {
  const t = text[lang]
  return html`<h1>${t.title}</h1>
    <section id="profile">
      <h2>${t.profile}</h2>
      ${
        owner.handle
          ? html`<div class="profile">
                ${profileCard(owner.handle, owner.profile, lang)}
              </div>
              <p>${t.handle}: <code>@${owner.handle}</code></p>
              <p>${t.handleNote}</p>
              <p><a href="/@${owner.handle}">${t.openProfile}</a></p>`
          : html`<p>${t.noHandle}</p>`
      }
      <p>${t.synced}</p>
      <p class="card-meta">
        ${
          owner.profile
            ? t.syncedOn(dayFormats[lang].format(owner.profile.syncedAt * 1000))
            : t.notSynced
        }
      </p>
      <p><a href="/auth/github?to=settings">${t.sync}</a></p>
    </section>
    <section id="mutes">
      <h2>${t.muted}</h2>
      ${
        owner.muted.length
          ? html`<ul>
              ${owner.muted.map(
                ({ handle }) =>
                  html`<li>
                    <form method="post" action="/mutes/${handle}/release">
                      <a href="/@${handle}">@${handle}</a>
                      <button type="submit">${t.release}</button>
                    </form>
                  </li>`,
              )}
            </ul>`
          : html`<p>${t.noneMuted}</p>`
      }
    </section>
    <section id="account">
      <h2>${t.account}</h2>
      <p>${t.signedInAs(owner.login)}</p>
      ${logoutForm(lang)} ${accountDeletion(owner.login, lang)}
    </section>`
}
