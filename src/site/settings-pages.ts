import { html } from 'hono/html'
import { accountDeletion, logoutForm } from '../decks/pages'
import {
  DELIVERED_KINDS,
  type NotificationKind,
} from '../notifications/notification'
import { notificationsTitle } from '../notifications/pages'
import { LANG_NAMES, LANGS, langHref, messages, type Lang } from './i18n'
import { settingsAgentFrame, type AgentSettings } from './settings-agent-frame'
import { peopleList } from './settings-people'
import { SERVICE_NAME } from './service'
import type { SyncedProfile } from '../profile/store'
import { dayFormats } from '../share/dates'

const text = messages({
  ja: {
    title: '設定',
    profile: 'プロフィール',
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
    account: 'アカウント',
    language: '言語',
    leave: '退会',
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
    language: 'Language',
    leave: 'Leave the service',
    signedInAs: (login: string) => `Signed in as ${login} on GitHub`,
  },
})

export const settingsTitle = (lang: Lang) => text[lang].title

type SettingsOwner = Readonly<{
  login: string
  handle: string | null
  profile: SyncedProfile | null
  muted: readonly { handle: string }[]
  optOuts: readonly NotificationKind[]
  agents: AgentSettings
}>

/** Who the author is, as synced from GitHub, with the way to sync again. */
const profileSection = (owner: SettingsOwner, lang: Lang) => {
  const t = text[lang]
  const name = owner.profile?.name ?? (owner.handle && `@${owner.handle}`)
  return html`<section class="panel" id="profile">
    <h2>${t.profile}</h2>
    ${
      owner.handle
        ? html`<div class="settings-identity">
              <span class="settings-face" aria-hidden="true"
                >${owner.login.slice(0, 1)}${
                  owner.profile?.avatarUrl
                    ? html`<img
                        data-cover
                        src="${owner.profile.avatarUrl}"
                        alt=""
                        referrerpolicy="no-referrer"
                      />`
                    : ''
                }</span
              >
              <p>
                <strong>${name}</strong><br />
                ${t.handle}: <code>@${owner.handle}</code>
              </p>
            </div>
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
    <p>
      <a class="button-secondary" href="/auth/github?to=settings">${t.sync}</a>
    </p>
  </section>`
}

const mutesSection = (owner: SettingsOwner, lang: Lang) => {
  const t = text[lang]
  return html`<section class="panel" id="mutes">
    <h2>${t.muted}</h2>
    ${peopleList(
      owner.muted.map(({ handle }) => handle),
      '/mutes',
      t.release,
      t.noneMuted,
    )}
  </section>`
}

const notificationsSection = (owner: SettingsOwner, lang: Lang) => {
  const t = text[lang]
  return html`<section class="panel" id="notifications">
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
  </section>`
}

/** The screen language: the current one pressed, the other a link. */
const languageSection = (lang: Lang, url: URL) =>
  html`<section class="panel" id="language">
    <h2>${text[lang].language}</h2>
    <p class="choice-row">
      ${LANGS.map((choice) =>
        choice === lang
          ? html`<span
              class="button-primary"
              lang="${choice}"
              aria-current="true"
              >${LANG_NAMES[choice]}</span
            >`
          : html`<a
              class="button-secondary"
              href="${langHref(url, choice)}"
              lang="${choice}"
              hreflang="${choice}"
              >${LANG_NAMES[choice]}</a
            >`,
      )}
    </p>
  </section>`

const accountSection = (owner: SettingsOwner, lang: Lang) =>
  html`<section class="panel" id="account">
    <h2>${text[lang].account}</h2>
    <p>${text[lang].signedInAs(owner.login)}</p>
    ${logoutForm(lang)}
  </section>`

const leaveSection = (owner: SettingsOwner, lang: Lang) =>
  html`<section class="panel" id="leave">
    <h2>${text[lang].leave}</h2>
    ${accountDeletion(owner.login, lang)}
  </section>`

/**
 * The author's settings, each part a frame of its own: the profile, putting
 * slides up from an AI agent, the people muted, notifications,
 * the language, the account, and last the way to leave the service. `url`
 * is the page itself, which the language choice reopens.
 */
export const settingsBody = (owner: SettingsOwner, lang: Lang, url: URL) =>
  html`<h1>${text[lang].title}</h1>
    ${profileSection(owner, lang)} ${settingsAgentFrame(lang, owner.agents)}
    ${mutesSection(owner, lang)} ${notificationsSection(owner, lang)}
    ${languageSection(lang, url)} ${accountSection(owner, lang)}
    ${leaveSection(owner, lang)}`
