import { html } from 'hono/html'
import { messages, type Lang } from './i18n'
import { SERVICE_NAME } from './service'

const text = messages({
  ja: {
    signIn: 'ログイン',
    decks: 'スライドの管理',
    newCommunity: 'コミュニティを作る',
    notifications: 'お知らせ',
    // {count} is replaced by the number of unread notifications.
    unread: 'お知らせ({count})',
    menu: 'メニュー',
    profile: 'プロフィール',
    settings: '設定',
    logout: 'ログアウト',
  },
  en: {
    signIn: 'Sign in',
    decks: 'Your slides',
    newCommunity: 'Create a community',
    notifications: 'Notifications',
    unread: 'Notifications ({count})',
    menu: 'Menu',
    profile: 'Profile',
    settings: 'Settings',
    logout: 'Sign out',
  },
})

/** Where the header's way in leads: the login page. */
export const SIGN_IN_PATH = '/login'

/**
 * The header every page shares. Its account area starts empty: pages, the
 * static top page among them, do not know the visitor when they are written.
 * /share.js asks who is signed in and puts the way in, or the link to the
 * bell and their menu, which holds the way to the author's slides and to
 * making a community. The words come from here so the
 * script holds none. Without scripts the way in is shown; the login page sends a
 * signed-in author straight on.
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
      data-new-community="${t.newCommunity}"
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
