import { html } from 'hono/html'
import { logoutForm } from '../decks/pages'
import { dayTimeFormats } from '../share/dates'
import { messages, type Lang } from './i18n'

const text = messages({
  ja: {
    heading: 'アカウント',
    handle: 'ハンドル',
    handleNote: '変えられません。',
    email: 'メールアドレス',
    emailNote: '自分にだけ見えます。',
    devices: 'ログイン中の端末',
    unknownDevice: '不明な端末',
    thisDevice: 'この端末',
    signedInAt: 'ログイン:',
    lastUsedAt: '最後に使った:',
    signOutDevice: 'ログアウト',
    signOutDeviceName: (name: string) => `${name} からログアウト`,
    otherDevices: (count: number) =>
      `ほかに ${count} 台の端末でログインしています。`,
    noOtherDevices: 'ほかの端末ではログインしていません。',
    signOutOthers: 'ほかの端末からログアウト',
    signedOutOthers: 'ほかの端末からログアウトしました。',
    signedOutDevice: 'その端末からログアウトしました。',
  },
  en: {
    heading: 'Account',
    handle: 'Handle',
    handleNote: 'It cannot be changed.',
    email: 'Email address',
    emailNote: 'Only you can see it.',
    devices: 'Signed-in devices',
    unknownDevice: 'Unknown device',
    thisDevice: 'This device',
    signedInAt: 'Signed in:',
    lastUsedAt: 'Last used:',
    signOutDevice: 'Sign out',
    signOutDeviceName: (name: string) => `Sign out ${name}`,
    otherDevices: (count: number) =>
      count === 1
        ? 'You are signed in on 1 other device.'
        : `You are signed in on ${count} other devices.`,
    noOtherDevices: 'You are not signed in on any other device.',
    signOutOthers: 'Sign out other devices',
    signedOutOthers: 'Signed out of the other devices.',
    signedOutDevice: 'Signed out of that device.',
  },
})

/** One device the person is signed in on; `current` is the one asking. */
export type DeviceRow = Readonly<{
  id: string
  /** The rough name ("iPhone · Safari"), or null when unknown. */
  device: string | null
  signedInAt: Date
  lastUsedAt: Date
  current: boolean
}>

/** What the person just did to their devices, if anything. */
export type DeviceNotice = 'none' | 'signed-out-others' | 'signed-out-device'

/**
 * Who the account is: the handle, the email address they sign in with, and
 * the devices they are signed in on now.
 */
export type AccountView = Readonly<{
  handle: string
  email: string
  devices: readonly DeviceRow[]
  notice: DeviceNotice
}>

const at = (time: Date, lang: Lang) =>
  html`<time datetime="${time.toISOString()}"
    >${dayTimeFormats[lang].format(time)}</time
  >`

const deviceRow = (row: DeviceRow, lang: Lang) => {
  const t = text[lang]
  const name = row.device ?? t.unknownDevice
  return html`<li class="device-row">
    <div class="device-row-text">
      <span class="device-name"
        >${name}${
          row.current
            ? html` <span class="device-current">${t.thisDevice}</span>`
            : ''
        }</span
      >
      <span class="device-times"
        >${t.signedInAt} ${at(row.signedInAt, lang)}</span
      >
      <span class="device-times"
        >${t.lastUsedAt} ${at(row.lastUsedAt, lang)}</span
      >
    </div>
    ${
      row.current
        ? ''
        : html`<form method="post" action="/auth/logout-device">
            <input type="hidden" name="session" value="${row.id}" />
            <button
              class="button-secondary"
              aria-label="${t.signOutDeviceName(name)}"
            >
              ${t.signOutDevice}
            </button>
          </form>`
    }
  </li>`
}

const noticeText = (notice: DeviceNotice, lang: Lang) =>
  notice === 'signed-out-others'
    ? text[lang].signedOutOthers
    : notice === 'signed-out-device'
      ? text[lang].signedOutDevice
      : null

const devicesFact = (account: AccountView, lang: Lang) => {
  const t = text[lang]
  const others = account.devices.filter((row) => !row.current).length
  const notice = noticeText(account.notice, lang)
  return html`<div class="account-devices">
    <dt>${t.devices}</dt>
    ${notice ? html`<dd class="field-note" role="status">${notice}</dd>` : ''}
    <dd>
      <ul class="device-list" role="list">
        ${account.devices.map((row) => deviceRow(row, lang))}
      </ul>
    </dd>
    <dd>${others > 0 ? t.otherDevices(others) : t.noOtherDevices}</dd>
    ${
      others > 0
        ? html`<dd>
            <form method="post" action="/auth/logout-others">
              <button class="button-secondary">${t.signOutOthers}</button>
            </form>
          </dd>`
        : ''
    }
  </div>`
}

/**
 * Where settings show the author's account: the handle and the email
 * address, with a note on each. This is the only page that shows the
 * address, and only to its owner. It also lists the devices signed in, each
 * with a way to sign it out, and a way to sign out all the others.
 */
export const settingsAccountFrame = (account: AccountView, lang: Lang) => {
  const t = text[lang]
  return html`<section class="panel" id="account">
    <h2>${t.heading}</h2>
    <dl class="account-facts">
      <div>
        <dt>${t.handle}</dt>
        <dd>@${account.handle}</dd>
        <dd class="field-note">${t.handleNote}</dd>
      </div>
      <div>
        <dt>${t.email}</dt>
        <dd>${account.email}</dd>
        <dd class="field-note">${t.emailNote}</dd>
      </div>
      ${devicesFact(account, lang)}
    </dl>
    ${logoutForm(lang)}
  </section>`
}
