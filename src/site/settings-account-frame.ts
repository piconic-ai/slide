import { html } from 'hono/html'
import { logoutForm } from '../decks/pages'
import { messages, type Lang } from './i18n'

const text = messages({
  ja: {
    heading: 'アカウント',
    handle: 'ハンドル',
    handleNote: '変えられません。',
    email: 'メールアドレス',
    emailNote: '自分にだけ見えます。',
    devices: 'ほかの端末',
    otherDevices: (count: number) =>
      `ほかに ${count} 台の端末でログインしています。`,
    noOtherDevices: 'ほかの端末ではログインしていません。',
    signOutOthers: 'ほかの端末からログアウト',
    signedOutOthers: 'ほかの端末からログアウトしました。',
  },
  en: {
    heading: 'Account',
    handle: 'Handle',
    handleNote: 'It cannot be changed.',
    email: 'Email address',
    emailNote: 'Only you can see it.',
    devices: 'Other devices',
    otherDevices: (count: number) =>
      count === 1
        ? 'You are signed in on 1 other device.'
        : `You are signed in on ${count} other devices.`,
    noOtherDevices: 'You are not signed in on any other device.',
    signOutOthers: 'Sign out other devices',
    signedOutOthers: 'Signed out of the other devices.',
  },
})

/**
 * Who the account is: the handle, and the email address they sign in with.
 * `otherDevices` counts the other devices signed in now; `signedOutOthers`
 * says the person just signed those out.
 */
export type AccountView = Readonly<{
  handle: string
  email: string
  otherDevices: number
  signedOutOthers: boolean
}>

const devicesFact = (account: AccountView, lang: Lang) => {
  const t = text[lang]
  return html`<div>
    <dt>${t.devices}</dt>
    <dd>
      ${
        account.otherDevices > 0
          ? t.otherDevices(account.otherDevices)
          : t.noOtherDevices
      }
    </dd>
    ${
      account.signedOutOthers
        ? html`<dd class="field-note" role="status">${t.signedOutOthers}</dd>`
        : ''
    }
    ${
      account.otherDevices > 0
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
 * address, and only to its owner. It also says how many other devices are
 * signed in, with the way to sign them out.
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
