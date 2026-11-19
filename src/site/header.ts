import { html } from 'hono/html'
import { messages, type Lang } from './i18n'
import { SERVICE_NAME } from './service'

const text = messages({
  ja: {
    signIn: 'ログイン',
    decks: 'スライドの管理',
    notifications: 'お知らせ',
    unread: '未読あり',
    menu: 'メニュー',
    profile: 'プロフィール',
    settings: '設定',
    logout: 'ログアウト',
  },
  en: {
    signIn: 'Sign in',
    decks: 'Your slides',
    notifications: 'Notifications',
    unread: 'unread',
    menu: 'Menu',
    profile: 'Profile',
    settings: 'Settings',
    logout: 'Sign out',
  },
})

/** Where the header's way in leads: straight to signing in with GitHub. */
export const SIGN_IN_PATH = '/auth/github'

/**
 * The header every page shares. Its account area starts empty: pages, the
 * static top page among them, do not know the visitor when they are written.
 * /share.js asks who is signed in and puts the way in, or the link to the
 * author's slides, the bell and their menu. The words come from here so the
 * script holds none. Without scripts the way in is shown; GitHub sends a
 * signed-in author straight back.
 */
export const siteHeader = (lang: Lang, account: 'shown' | 'none' = 'shown') => {
  const t = text[lang]
  // A page for someone who may not use their account draws no account area:
  // the session would not answer for them.
  if (account === 'none')
    return html`<header class="site-header">
      <a class="brand" href="/">${SERVICE_NAME}</a>
    </header>`
  return html`<header class="site-header">
    <a class="brand" href="/">${SERVICE_NAME}</a>
    <span
      class="account"
      data-account
      data-sign-in="${t.signIn}"
      data-decks="${t.decks}"
      data-notifications="${t.notifications}"
      data-unread="${t.unread}"
      data-menu="${t.menu}"
      data-profile="${t.profile}"
      data-settings="${t.settings}"
      data-logout="${t.logout}"
    ></span>
    <noscript><a href="${SIGN_IN_PATH}">${t.signIn}</a></noscript>
  </header>`
}
