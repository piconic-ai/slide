import { html } from 'hono/html'
import { accountDeletion, logoutForm } from '../decks/pages'
import {
  DELIVERED_KINDS,
  type NotificationKind,
} from '../notifications/notification'
import { notificationsTitle } from '../notifications/pages'
import { LANG_NAMES, LANGS, langHref, messages, type Lang } from './i18n'
import { settingsAgentFrame, type AgentSettings } from './settings-agent-frame'
import { settingsAccountFrame } from './settings-account-frame'
import { settingsBlocksFrame } from './settings-blocks-frame'
import { settingsCommunitiesFrame } from './settings-communities-frame'
import {
  settingsProfileFrame,
  type ProfileFormView,
} from './settings-profile-frame'
import { peopleList } from './settings-people'
import { SERVICE_NAME } from './service'

const text = messages({
  ja: {
    title: '設定',
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
    language: '言語',
    leave: '退会',
  },
  en: {
    title: 'Settings',
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
    language: 'Language',
    leave: 'Leave the service',
  },
})

export const settingsTitle = (lang: Lang) => text[lang].title

type SettingsOwner = Readonly<{
  login: string
  handle: string
  /** The address they sign in with; shown here and nowhere else. */
  email: string
  profileForm: ProfileFormView
  muted: readonly { handle: string }[]
  optOuts: readonly NotificationKind[]
  agents: AgentSettings
}>

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

const leaveSection = (owner: SettingsOwner, lang: Lang) =>
  html`<section class="panel" id="leave">
    <h2>${text[lang].leave}</h2>
    ${accountDeletion(owner.login, lang)}
  </section>`

/**
 * The author's settings, each part a frame of its own: the profile, putting
 * slides up from an AI agent, the communities managed, the people blocked,
 * the people muted, notifications,
 * the language, the account, and last the way to leave the service. `url`
 * is the page itself, which the language choice reopens.
 */
export const settingsBody = (owner: SettingsOwner, lang: Lang, url: URL) =>
  html`<h1>${text[lang].title}</h1>
    ${settingsProfileFrame(owner.profileForm, lang)}
    ${settingsAccountFrame({ handle: owner.handle, email: owner.email }, lang)}
    ${settingsAgentFrame(lang, owner.agents)} ${settingsCommunitiesFrame(lang)}
    ${settingsBlocksFrame(lang)} ${mutesSection(owner, lang)}
    ${notificationsSection(owner, lang)} ${languageSection(lang, url)}
    ${leaveSection(owner, lang)}`
