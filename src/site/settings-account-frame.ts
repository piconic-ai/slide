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
  },
  en: {
    heading: 'Account',
    handle: 'Handle',
    handleNote: 'It cannot be changed.',
    email: 'Email address',
    emailNote: 'Only you can see it.',
  },
})

/** Who the account is: the handle, and the email address they sign in with. */
export type AccountView = Readonly<{ handle: string; email: string }>

/**
 * Where settings show the author's account: the handle and the email
 * address, with a note on each. This is the only page that shows the
 * address, and only to its owner.
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
    </dl>
    ${logoutForm(lang)}
  </section>`
}
