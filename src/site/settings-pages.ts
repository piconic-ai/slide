import { html } from 'hono/html'
import { accountDeletion, logoutForm } from '../decks/pages'
import {
  DELIVERED_KINDS,
  type NotificationKind,
} from '../notifications/notification'
import { notificationsTitle } from '../notifications/pages'
import { messages, type Lang } from './i18n'
import { SERVICE_NAME } from './service'
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
    following: 'フォローしている人',
    noneFollowing: 'フォローしている人はいません。',
    unfollow: {
      label: '解除',
      name: (handle: string) => `@${handle} のフォローを解除`,
    },
    muted: 'ミュートしている人',
    noneMuted: 'ミュートしている人はいません。',
    release: {
      label: '解除',
      name: (handle: string) => `@${handle} のミュートを解除`,
    },
    notificationKinds: {
      cited: '自分のスライドが引用された',
      followee_published: 'フォローしている人が、スライドを公開した',
      followed: 'フォローされた',
      github_followee_joined: `GitHub でフォローしている人が、${SERVICE_NAME} を使い始めた`,
    },
    receiving: '受け取る',
    notReceiving: '受け取らない',
    enable: {
      label: '受け取るようにする',
      name: (kind: string) => `「${kind}」を受け取るようにする`,
    },
    disable: {
      label: '受け取りを止める',
      name: (kind: string) => `「${kind}」の受け取りを止める`,
    },
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
    following: 'People you follow',
    noneFollowing: 'You aren’t following anyone.',
    unfollow: {
      label: 'Unfollow',
      name: (handle: string) => `Unfollow @${handle}`,
    },
    muted: 'People you muted',
    noneMuted: 'You haven’t muted anyone.',
    release: {
      label: 'Unmute',
      name: (handle: string) => `Unmute @${handle}`,
    },
    notificationKinds: {
      cited: 'Your slides were cited',
      followee_published: 'Someone you follow published slides',
      followed: 'Someone followed you',
      github_followee_joined: `Someone you follow on GitHub started using ${SERVICE_NAME}`,
    },
    receiving: 'Receiving',
    notReceiving: 'Not receiving',
    enable: {
      label: 'Start receiving',
      name: (kind: string) => `Start receiving “${kind}” notifications`,
    },
    disable: {
      label: 'Stop receiving',
      name: (kind: string) => `Stop receiving “${kind}” notifications`,
    },
    account: 'Account',
    signedInAs: (login: string) => `Signed in as ${login} on GitHub`,
  },
})

export const settingsTitle = (lang: Lang) => text[lang].title

function peopleList(
  handles: readonly string[],
  action: '/follows' | '/mutes',
  release: { label: string; name: (handle: string) => string },
  empty: string,
) {
  if (!handles.length) return html`<p>${empty}</p>`
  return html`<ul class="settings-rows" role="list">
    ${handles.map(
      (handle) =>
        html`<li>
          <form method="post" action="${action}/${handle}/release">
            <a href="/@${handle}">@${handle}</a>
            <button
              class="button-secondary"
              type="submit"
              aria-label="${release.name(handle)}"
            >
              ${release.label}
            </button>
          </form>
        </li>`,
    )}
  </ul>`
}

/**
 * The author's settings: what their profile shows, then the account itself,
 * ending with the way to leave the service.
 */
export const settingsBody = (
  owner: Readonly<{
    login: string
    handle: string | null
    profile: SyncedProfile | null
    following: readonly string[]
    muted: readonly { handle: string }[]
    optOuts: readonly NotificationKind[]
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
    <section id="following">
      <h2>${t.following}</h2>
      ${peopleList(owner.following, '/follows', t.unfollow, t.noneFollowing)}
    </section>
    <section id="mutes">
      <h2>${t.muted}</h2>
      ${peopleList(
        owner.muted.map(({ handle }) => handle),
        '/mutes',
        t.release,
        t.noneMuted,
      )}
    </section>
    <section id="notifications">
      <h2>${notificationsTitle(lang)}</h2>
      <ul class="settings-rows" role="list">
        ${DELIVERED_KINDS.map((kind) => {
          const optedOut = owner.optOuts.includes(kind)
          const label = t.notificationKinds[kind]
          const action = optedOut ? t.enable : t.disable
          return html`<li>
            <form method="post" action="/notifications/preferences">
              <span class="preference-kind">${label}</span>
              <span class="preference-state">
                ${optedOut ? t.notReceiving : t.receiving}
              </span>
              <input type="hidden" name="kind" value="${kind}" />
              <input
                type="hidden"
                name="receive"
                value="${optedOut ? '1' : '0'}"
              />
              <button
                class="button-secondary"
                type="submit"
                aria-label="${action.name(label)}"
              >
                ${action.label}
              </button>
            </form>
          </li>`
        })}
      </ul>
    </section>
    <section id="account">
      <h2>${t.account}</h2>
      <p>${t.signedInAs(owner.login)}</p>
      ${logoutForm(lang)} ${accountDeletion(owner.login, lang)}
    </section>`
}
