import { notificationsTitle } from '../notifications/pages'
import { manageLink } from '../reactions/pages'
import type { Context } from 'hono'
import { html } from 'hono/html'
import { designTokensCssRaw } from '../site/design-tokens'
import { siteFooter } from '../site/footer'
import { messages, type Lang } from '../site/i18n'
import { langOf } from '../site/lang'
import { SERVICE_NAME } from '../site/service'
import type { HtmlEscapedString } from 'hono/utils/html'
import type { HistoryEntry } from './history'
import { AVATAR_ORIGIN } from '../profile/github-profile'
import { reasonLabel, stateLabel } from './history'
import {
  deploymentActions,
  publicationPanel,
  type PanelView,
} from '../publication/panel'

type Html = HtmlEscapedString | Promise<HtmlEscapedString>

// Owner pages render only service markup and the service's own scripts;
// uploaded HTML is never served here.
// The header asks the service who is signed in, hence connect-src.
// The one image a page shows is an author's picture, served by GitHub: on
// their profile, and as the header's icon when they are signed in.
const PAGE_POLICY = `default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self' https://github.com; base-uri 'none'; frame-ancestors 'none'; img-src ${AVATAR_ORIGIN}`

/**
 * The static top page fetches its recent decks from the same origin and
 * shows each one's cover image: a file of the deck, or the cover the service
 * takes. The decks are not known when the page is answered, so any
 * deployment origin may give an image. No deck is framed. The header's icon
 * is the signed-in author's picture, as on every page.
 */
export const homePagePolicy = (contentBase: URL | null) =>
  contentBase
    ? `${PAGE_POLICY} 'self' ${contentBase.protocol}//*.${contentBase.host}`
    : PAGE_POLICY

export const pageStyle = html`<style>
  ${designTokensCssRaw} body {
    font: 16px/1.8 var(--font-sans);
    max-width: 960px;
    margin: 4vh auto;
    padding: 0 16px;
    color: var(--foreground);
    background: var(--background);
    /* Handles and deck IDs are long unbroken words on narrow screens. */
    overflow-wrap: anywhere;
  }
  a {
    color: var(--foreground);
    text-decoration: underline;
  }
  :focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  /*
   * Outline sits outside the control on the page canvas. On a white page keep
   * --ring (ink). White outlines belong only on truly dark surrounds (navy
   * color-blocks), which stage 4 can scope.
   */
  table {
    width: 100%;
    border-collapse: collapse;
    background: var(--card);
  }
  th,
  td {
    text-align: left;
    padding: 8px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  code {
    overflow-wrap: anywhere;
  }
  pre {
    background: var(--card);
    border: 1px solid var(--border);
    padding: 12px;
    overflow-x: auto;
  }
  pre code {
    overflow-wrap: normal;
  }
  form {
    margin: 16px 0;
  }
  button,
  input,
  textarea,
  select {
    font: inherit;
  }
  button {
    padding: 6px 10px;
  }
  .text-input,
  input:not(
    [type='checkbox'],
    [type='radio'],
    [type='file'],
    [type='hidden'],
    [type='submit'],
    [type='button'],
    [type='reset'],
    [type='image'],
    [type='range'],
    [type='color']
  ),
  textarea,
  select {
    box-sizing: border-box;
    padding: 10px 12px;
    border: 1px solid var(--input);
    border-radius: var(--radius);
    background: var(--background);
    color: var(--foreground);
    font: 16px/1.8 var(--font-sans);
  }
  .text-input:focus,
  input:not(
      [type='checkbox'],
      [type='radio'],
      [type='file'],
      [type='hidden'],
      [type='submit'],
      [type='button'],
      [type='reset'],
      [type='image'],
      [type='range'],
      [type='color']
    ):focus,
  textarea:focus,
  select:focus {
    border: 2px solid var(--foreground);
    outline: none;
  }
  input[type='checkbox'],
  input[type='radio'] {
    accent-color: var(--foreground);
  }
  .button-primary,
  .cta,
  .button-secondary,
  .site-header > noscript a,
  .site-header .account > a:not(.add),
  .button-danger {
    display: inline-block;
    box-sizing: border-box;
    min-height: 40px;
    border-radius: var(--radius-full);
    font: 600 15px/1.2 var(--font-sans);
    text-align: center;
    text-decoration: none;
    cursor: pointer;
  }
  .button-primary,
  .cta {
    padding: 10px 20px;
    border: 0;
    background: var(--primary);
    color: var(--primary-foreground);
  }
  .button-primary:hover,
  .cta:hover {
    opacity: 0.85;
  }
  .button-secondary,
  .site-header > noscript a,
  .site-header .account > a:not(.add) {
    padding: 9px 19px;
    border: 1px solid var(--input);
    background: var(--background);
    color: var(--foreground);
  }
  .button-secondary:hover,
  .site-header > noscript a:hover,
  .site-header .account > a:not(.add):hover {
    background: var(--secondary);
  }
  .button-danger {
    padding: 9px 19px;
    border: 1px solid var(--destructive);
    background: var(--background);
    color: var(--destructive);
  }
  .button-danger:disabled {
    opacity: 0.5;
  }
  .reason {
    color: var(--destructive);
  }
  .site-header {
    display: flex;
    align-items: center;
    gap: 16px;
    height: 56px;
    margin-bottom: 24px;
    background: var(--background);
    color: var(--foreground);
    font-size: 14px;
    line-height: 1.7;
  }
  .site-header .brand {
    font-weight: 700;
    font-size: 20px;
    color: inherit;
    text-decoration: none;
    margin-right: auto;
  }
  /* Holds its height while empty, so the header does not move when filled. */
  .site-header .account {
    display: flex;
    align-items: center;
    min-height: 32px;
  }
  .site-header .account {
    gap: 12px;
  }
  .button-icon,
  .site-header .avatar,
  .site-header .add {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--secondary);
    color: var(--foreground);
    font-weight: 600;
    font-size: 15px;
    line-height: 1.2;
    text-decoration: none;
    cursor: pointer;
  }
  .site-header .avatar {
    position: relative;
    overflow: hidden;
    text-transform: uppercase;
    list-style: none;
  }
  /* The author's picture covers their initial, which stays if it fails. */
  .site-header .avatar img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .site-header .avatar::-webkit-details-marker {
    display: none;
  }
  .site-header .add {
    position: relative;
  }
  /*
   * The plus is two bars at the centre: a "+" glyph sits off it in most
   * fonts. They are borders, which forced colours keep, unlike a background.
   */
  .site-header .add::before,
  .site-header .add::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }
  .site-header .add::before {
    width: 12px;
    border-top: 2px solid currentColor;
  }
  .site-header .add::after {
    height: 12px;
    border-left: 2px solid currentColor;
  }
  .site-header .menu {
    position: relative;
  }
  .site-header .menu-items {
    position: absolute;
    right: 0;
    top: 40px;
    z-index: 10;
    min-width: 200px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--card);
    box-shadow: var(--shadow-menu);
  }
  .site-header .menu-items form {
    margin: 0;
    border-top: 1px solid var(--border-soft);
  }
  .site-header .menu-items a,
  .site-header .menu-items button {
    display: block;
    box-sizing: border-box;
    width: 100%;
    padding: 8px 12px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }
  .site-header .menu-items a:hover,
  .site-header .menu-items button:hover {
    background: var(--secondary);
  }
  .hero {
    padding: 40px 0 24px;
  }
  .hero h1 {
    font-size: clamp(28px, 6vw, 44px);
    line-height: 1.25;
    margin: 0 0 16px;
  }
  .hero p {
    line-height: 1.7;
    max-width: 40em;
  }
  .cards {
    list-style: none;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 16px;
  }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 16px;
  }
  .card-title {
    font-weight: 600;
    font-size: 17px;
    color: inherit;
    overflow-wrap: anywhere;
  }
  .notification-list,
  .settings-rows {
    list-style: none;
    padding: 0;
    display: grid;
  }
  .notification-item {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    column-gap: 8px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
    line-height: 1.6;
    color: inherit;
    text-decoration: none;
  }
  .notification-list .unread .notification-item {
    grid-template-columns: 12px minmax(0, 1fr);
  }
  .notification-item:is(:hover, :focus-visible) .notification-message {
    text-decoration: underline;
  }
  .unread-dot {
    grid-row: 1 / span 2;
    align-self: start;
    width: 8px;
    height: 8px;
    margin-top: 0.55em;
    border-radius: var(--radius-full);
    background: var(--unread);
  }
  .notification-list .unread .notification-message {
    font-weight: 600;
  }
  .notification-message,
  .notification-meta {
    grid-column: 1;
  }
  .notification-list .unread .notification-message,
  .notification-list .unread .notification-meta {
    grid-column: 2;
  }
  .notification-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    color: var(--muted-foreground);
    font-size: 13px;
    font-weight: 400;
    line-height: 1.6;
  }
  /* The word stays for screen readers. The dot is the visual mark. */
  .new-badge {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .settings-rows {
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: 16px;
  }
  .settings-rows li,
  .settings-rows form {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: center;
  }
  .settings-rows li {
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }
  .settings-rows form {
    margin: 0;
    row-gap: 6px;
  }
  .preference-state {
    color: var(--muted-foreground);
  }
  @media (width > 600px) {
    #notifications .settings-rows {
      grid-template-columns: minmax(0, 1fr) auto auto;
    }
  }
  @media (max-width: 600px) {
    .preference-kind {
      grid-column: 1 / -1;
    }
  }
  .profile h1,
  .card-meta {
    overflow-wrap: anywhere;
  }
  .color-block {
    position: relative;
    overflow: hidden;
    border-radius: var(--radius-block);
    padding: var(--space-block);
    color: var(--foreground);
  }
  .color-block-purple {
    background: var(--block-purple);
  }
  .profile-head h1 {
    margin: 0;
    font-size: 32px;
    font-weight: 700;
    line-height: 1.35;
  }
  .profile-head .card-meta {
    margin: 4px 0 0;
    color: var(--foreground);
    font-size: 16px;
    font-weight: 400;
    line-height: 1.8;
  }
  .profile-heading {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    column-gap: 12px;
    row-gap: 8px;
  }
  .profile-heading form {
    margin: 0;
  }
  .profile-heading button:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  /*
   * Pressing "following" unfollows; hover and focus say so before the press.
   * Both labels share one grid cell, so the button keeps the width of the
   * longer one and the pointer never falls off it when the label changes.
   */
  .profile-heading button.following {
    display: inline-grid;
  }
  .profile-heading button.following .state,
  .profile-heading button.following .act {
    grid-area: 1 / 1;
  }
  .profile-heading button.following .act,
  .profile-heading button.following:hover .state,
  .profile-heading button.following:focus-visible .state {
    visibility: hidden;
  }
  .profile-heading button.following:hover .act,
  .profile-heading button.following:focus-visible .act {
    visibility: visible;
  }
  .profile-heading button.following:hover,
  .profile-heading button.following:focus-visible {
    border-color: var(--destructive);
    color: var(--destructive);
  }
  .profile .portrait {
    display: block;
    width: 96px;
    height: 96px;
    border-radius: var(--radius-full);
    background: var(--border);
  }
  .profile .profile-head .portrait {
    margin: 0 0 16px;
    background: var(--block-purple-deep);
    object-fit: cover;
  }
  .profile .facts {
    list-style: none;
    margin: 12px 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 20px;
    overflow-wrap: anywhere;
  }
  .profile .fact-name {
    color: var(--muted-foreground);
    font-size: 14px;
    margin-right: 4px;
  }
  .card-meta,
  .empty {
    color: var(--muted-foreground);
    font-size: 14px;
    margin: 8px 0 0;
  }
  .published h2 {
    font-size: 24px;
    font-weight: 700;
    line-height: 1.4;
  }
  .deck-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 24px;
  }
  .deck-card {
    min-width: 0;
    background: none;
    border: 0;
    padding: 0;
  }
  .deck-cover {
    display: block;
    aspect-ratio: 16 / 9;
    margin-bottom: 12px;
    border-radius: var(--radius);
    background: var(--stage);
  }
  .deck-card .card-title {
    display: block;
    font-size: 18px;
    font-weight: 700;
    line-height: 1.5;
    text-decoration: none;
  }
  .deck-card .card-meta {
    margin: 4px 0 0;
    color: var(--muted-foreground);
    font-size: 13px;
    font-weight: 400;
    line-height: 1.6;
  }
  .empty-state {
    border-radius: var(--radius-block);
    padding: 24px;
    background: var(--block-ecru);
    color: var(--foreground);
  }
  .empty-state p {
    margin: 0 0 16px;
    color: var(--foreground);
    font-size: 16px;
    font-weight: 400;
    line-height: 1.8;
  }
  .empty-state p:last-child {
    margin-bottom: 0;
  }
  .narrow {
    max-width: 640px;
  }
  .narrow h1 {
    font-size: 32px;
    font-weight: 700;
    line-height: 1.35;
  }
  .field-label {
    display: block;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.7;
  }
  .notice-success,
  .notice-warning,
  .notice-danger {
    border-radius: var(--radius);
    padding: 12px 16px;
    border: 1px solid;
  }
  .notice-success {
    background: var(--success-soft);
    color: var(--success);
    border-color: var(--success);
  }
  .notice-warning {
    background: var(--warning-soft);
    color: var(--warning);
    border-color: var(--warning);
  }
  .notice-danger {
    background: var(--destructive-soft);
    color: var(--destructive);
    border-color: var(--destructive);
  }
</style>`

const headerText = messages({
  ja: {
    start: 'はじめる',
    add: 'スライドを追加',
    menu: 'メニュー',
    profile: 'プロフィール',
    decks: 'スライドの管理',
    settings: '設定',
    logout: 'ログアウト',
  },
  en: {
    start: 'Get started',
    add: 'Add slides',
    menu: 'Menu',
    profile: 'Profile',
    decks: 'Your slides',
    settings: 'Settings',
    logout: 'Sign out',
  },
})

/**
 * The header's account area starts empty: pages, the static top page among
 * them, do not know the visitor when they are written. /share.js asks who is
 * signed in and puts the way in, or a button to add slides beside the
 * author's icon, which opens their menu. The words come from here so the
 * script holds none. Without scripts the way in is shown; it sends a
 * signed-in author on to their decks, which link to the settings.
 */
export const siteHeader = (lang: Lang) => {
  const t = headerText[lang]
  return html`<header class="site-header">
    <a class="brand" href="/">${SERVICE_NAME}</a>
    <span
      class="account"
      data-account
      data-start="${t.start}"
      data-add="${t.add}"
      data-menu="${t.menu}"
      data-profile="${t.profile}"
      data-decks="${t.decks}"
      data-settings="${t.settings}"
      data-logout="${t.logout}"
    ></span>
    <noscript><a href="/start">${t.start}</a></noscript>
  </header>`
}

export function renderPage<E extends { Bindings: Env }>(
  c: Context<E>,
  title: string,
  body: Html,
  status: 200 | 400 | 401 | 404 = 200,
) {
  const lang = langOf(c)
  c.header('Content-Security-Policy', PAGE_POLICY)
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  return c.html(
    html`<!doctype html>
      <html lang="${lang}">
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width" />
        <title>${title} - ${SERVICE_NAME}</title>
        ${pageStyle}
        <script src="/share.js" defer></script>
        <body>
          ${siteHeader(lang)} ${body} ${siteFooter(lang, new URL(c.req.url))}
        </body>
      </html>`,
    status,
  )
}

const accountText = messages({
  ja: {
    signInTitle: 'ログイン',
    signIn: '本人の GitHub アカウントでログインしてください。',
    signInLink: 'GitHub でログイン',
    logout: 'ログアウト',
    deleteAccount: '退会する',
    deleteAccountNote:
      'すべてのスライドを削除し、ログインを終えます。公開中の URL はすぐに読めなくなり、受領した版のファイルと記録は 24 時間ほど後に消えます。元には戻せません。',
    deleteAccountConfirm: (login: Html) =>
      html`確認のため、GitHub のユーザー名 ${login} を入力してください`,
    deleteAccountFailedTitle: '退会できませんでした',
    deleteAccountMismatch:
      '入力したユーザー名が一致しません。何も削除していません。',
    backToSettings: '設定に戻る',
    decksTitle: 'スライドの管理',
    settings: '設定',
    signedInAs: (login: string) => `${login} としてログイン中`,
    connect: 'リポジトリを連携する',
    columns: {
      deck: 'スライド',
      repository: 'リポジトリ',
      branches: '許可ブランチ',
    },
    noDecks: 'まだスライドはありません。',
    decks: 'スライド一覧',
    deckListLink: 'スライド一覧',
    buildComment: `必要ならここでスライドをビルドする。${SERVICE_NAME} はファイルを送るだけ`,
    step1: '1. スライドとリポジトリを登録する',
    step1Note:
      '管理権限のあるリポジトリに GitHub App をインストールしてから連携します。送信を許可するブランチは空白かカンマで区切ります。',
    deckId: 'スライド ID',
    repository: 'リポジトリ（owner/name）',
    branches: 'ブランチ',
    confirmOnGitHub: 'GitHub で確認して連携する',
    step2: '2. GitHub Actions から送る',
    step2Note: (code: (text: string) => Html) =>
      html`連携したリポジトリに ${code('.github/workflows/slide.yml')}
      を置きます。${code('directory')} には ${code('index.html')}
      を含むビルド済みの directory、${code('slide')} には 1. で登録したスライド
      ID を書きます。${SERVICE_NAME} はビルドせず、ファイルを送るだけです。`,
    step3: '3. 確かめて公開する',
    step3Note: (decks: Html, share: Html | null) =>
      html`workflow が終わったら、${decks}
      からスライドを開きます。受領した版は下書きで、作者だけが開けます。
      受領履歴から版を一般公開すると、${share ? html`${share} で` : '共有 URL から'}誰でも読めるようになります。`,
    deckIdPlaceholder: 'スライド ID',
    repositoryMode: (code: Html) =>
      html`スライドの管理画面で公開方法を「リポジトリ設定に従う」に切り替えると、workflow
      の ${code} で受領と同時に公開できます。`,
  },
  en: {
    signInTitle: 'Sign in',
    signIn: 'Sign in with your own GitHub account.',
    signInLink: 'Sign in with GitHub',
    logout: 'Sign out',
    deleteAccount: 'Delete account',
    deleteAccountNote:
      'Deletes all your slides and signs you out. Public URLs stop working at once, and the files and records of received versions are erased about 24 hours later. This cannot be undone.',
    deleteAccountConfirm: (login: Html) =>
      html`To confirm, type your GitHub username ${login}`,
    deleteAccountFailedTitle: 'Could not delete your account',
    deleteAccountMismatch:
      'The username you typed does not match. Nothing was deleted.',
    backToSettings: 'Back to settings',
    decksTitle: 'Your slides',
    settings: 'Settings',
    signedInAs: (login: string) => `Signed in as ${login}`,
    connect: 'Connect a repository',
    columns: {
      deck: 'Slides',
      repository: 'Repository',
      branches: 'Allowed branches',
    },
    noDecks: 'No slides yet.',
    decks: 'Your slides',
    deckListLink: 'your list of slides',
    buildComment: `Build your slides here if needed. ${SERVICE_NAME} only sends the files`,
    step1: '1. Register your slides and their repository',
    step1Note:
      'Install the GitHub App on a repository you administer, then connect it. Separate the branches allowed to upload with spaces or commas.',
    deckId: 'Slide ID',
    repository: 'Repository (owner/name)',
    branches: 'Branches',
    confirmOnGitHub: 'Confirm on GitHub and connect',
    step2: '2. Upload from GitHub Actions',
    step2Note: (code: (text: string) => Html) =>
      html`Add ${code('.github/workflows/slide.yml')} to the connected
      repository. Set ${code('directory')} to the built directory that holds
      ${code('index.html')}, and ${code('slide')} to the slide ID from step 1.
      ${SERVICE_NAME} does not build anything; it only sends the files.`,
    step3: '3. Check it, then publish',
    step3Note: (decks: Html, share: Html | null) =>
      html`When the workflow finishes, open the slides from ${decks}. A received
      version is a draft that only you can open. Publish a version from the
      upload history, and anyone can read it
      ${share ? html`at ${share}` : 'from its share link'}.`,
    deckIdPlaceholder: 'slide-id',
    repositoryMode: (code: Html) =>
      html`Switch the slides' publishing mode to “follow the repository”, and
      ${code} in the workflow publishes each version as soon as it is received.`,
  },
})

/** Page titles of the account pages, for renderPage. */
export const accountTitles = (lang: Lang) => accountText[lang]

export const signInPrompt = (lang: Lang) =>
  html`<h1>${SERVICE_NAME}</h1>
    <p>${accountText[lang].signIn}</p>
    <p><a href="/auth/github">${accountText[lang].signInLink}</a></p>`

export const logoutForm = (lang: Lang) =>
  html`<form method="post" action="/auth/logout">
    <button>${accountText[lang].logout}</button>
  </form>`

export const accountDeletion = (login: string, lang: Lang) => {
  const t = accountText[lang]
  return html`<h3>${t.deleteAccount}</h3>
    <p>${t.deleteAccountNote}</p>
    <form method="post" action="/account/delete">
      <label
        >${t.deleteAccountConfirm(html`<code>${login}</code>`)}
        <input name="confirm" autocomplete="off" required
      /></label>
      <button type="submit">${t.deleteAccount}</button>
    </form>`
}

export const accountMismatchBody = (lang: Lang) =>
  html`<h1>${accountText[lang].deleteAccountFailedTitle}</h1>
    <p>${accountText[lang].deleteAccountMismatch}</p>
    <p><a href="/settings">${accountText[lang].backToSettings}</a></p>`

export function deckListBody(
  login: string,
  decks: readonly {
    deck: string
    repository: string
    allowedRefs: readonly string[]
  }[],
  unread: number,
  lang: Lang,
): Html {
  const t = accountText[lang]
  const rows = decks.map(
    (deck) =>
      html`<tr>
        <td><a href="/slides/${deck.deck}">${deck.deck}</a></td>
        <td>${deck.repository}</td>
        <td>${deck.allowedRefs.map((ref) => html`<code>${ref}</code> `)}</td>
      </tr>`,
  )
  return html`<h1>${t.decksTitle}</h1>
    <p>${t.signedInAs(login)}</p>
    <p><a href="/notifications">${notificationsTitle(lang, unread)}</a></p>
    <p><a class="cta" href="/slides/new">${t.connect}</a></p>
    <table>
      <tr>
        <th>${t.columns.deck}</th>
        <th>${t.columns.repository}</th>
        <th>${t.columns.branches}</th>
      </tr>
      ${
        rows.length
          ? rows
          : html`<tr>
              <td colspan="3">${t.noDecks}</td>
            </tr>`
      }
    </table>
    <p><a href="/settings">${t.settings}</a></p>`
}

// The action is referenced by commit until its distribution name is decided.
export const ACTION_REF =
  'piconic-ai/slide@7c2329df2bfe031cb2d694f687d8057dd8bd4b52'

const workflowExample = (lang: Lang) => `name: Upload slides
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
jobs:
  upload:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v7.0.1
      - uses: actions/setup-node@v7.1.0
        with:
          node-version: 24
      # ${accountText[lang].buildComment}
      - uses: ${ACTION_REF}
        with:
          directory: dist
          slide: my-talk`

const code = (text: string) => html`<code>${text}</code>`

export const connectBody = (
  login: string,
  handle: string | null,
  lang: Lang,
): Html => {
  const t = accountText[lang]
  return html`<p><a href="/slides">${t.decks}</a></p>
    <h1>${t.connect}</h1>
    <p>${t.signedInAs(login)}</p>
    <h2>${t.step1}</h2>
    <p>${t.step1Note}</p>
    <form method="post" action="/slides/connect">
      <p>
        <label
          >${t.deckId}
          <input
            name="deck"
            required
            pattern="[a-z0-9](?:[a-z0-9\\-]{0,62}[a-z0-9])?"
        /></label>
      </p>
      <p>
        <label>${t.repository} <input name="repository" required /></label>
      </p>
      <p>
        <label
          >${t.branches} <input name="branches" value="main" required
        /></label>
      </p>
      <button>${t.confirmOnGitHub}</button>
    </form>
    <h2>${t.step2}</h2>
    <p>${t.step2Note(code)}</p>
    <pre><code>${workflowExample(lang)}</code></pre>
    <h2>${t.step3}</h2>
    <p>
      ${t.step3Note(
        html`<a href="/slides">${t.deckListLink}</a>`,
        handle ? code(`/@${handle}/${t.deckIdPlaceholder}`) : null,
      )}
    </p>
    <p>${t.repositoryMode(code('published: true'))}</p>`
}

const deckText = messages({
  ja: {
    decks: 'スライド一覧',
    notFoundTitle: '見つかりません',
    notFound: 'スライドが見つかりません',
    historyTitle: (deck: string) => `${deck} の履歴`,
    missing: (count: number) => `未受領 ${count} 件`,
    more: (count: number) => `ほか ${count} 件`,
    deleteHeading: 'スライドを削除する',
    deleteNote:
      '公開中の URL と作者限定の閲覧はすぐに読めなくなり、repository との連携も外れます。受領したすべての版のファイルと記録は、24 時間ほど後に消えます。元には戻せません。',
    deleteConfirm: (deck: Html) =>
      html`確認のため、スライド名 ${deck} を入力してください`,
    delete: '削除する',
    deleteFailedTitle: '削除できませんでした',
    deleteMismatch: '入力したスライド名が一致しません。何も削除していません。',
    backToDeck: 'スライドに戻る',
    history: '受領履歴',
    historyNoteDelivery:
      '受領完了の版は、一般公開するまで作者だけが開けます。作者限定で開くと別の tab で表示し、この画面は残ります。',
    historyNote: '受領完了の版は、一般公開するまで作者だけのものです。',
    columns: {
      state: '状態',
      files: 'ファイル',
      started: '開始',
      publish: '公開',
    },
    noVersions: 'まだ受領した版はありません。',
    older: 'さらに古い版',
  },
  en: {
    decks: 'Your slides',
    notFoundTitle: 'Not found',
    notFound: 'Slides not found',
    historyTitle: (deck: string) => `${deck} history`,
    missing: (count: number) => `${count} not received`,
    more: (count: number) => `${count} more`,
    deleteHeading: 'Delete these slides',
    deleteNote:
      'Their public URL and author-only views stop working at once, and they are disconnected from the repository. The files and records of every received version are erased about 24 hours later. This cannot be undone.',
    deleteConfirm: (deck: Html) => html`To confirm, type the slide ID ${deck}`,
    delete: 'Delete',
    deleteFailedTitle: 'Could not delete',
    deleteMismatch:
      'The slide ID you typed does not match. Nothing was deleted.',
    backToDeck: 'Back to the slides',
    history: 'Upload history',
    historyNoteDelivery:
      'A received version is open only to you until you publish it. Opening it as the author shows it in another tab and keeps this page.',
    historyNote: 'A received version stays yours alone until you publish it.',
    columns: {
      state: 'State',
      files: 'Files',
      started: 'Started',
      publish: 'Publish',
    },
    noVersions: 'No versions received yet.',
    older: 'Older versions',
  },
})

/** Page titles of the deck pages, for renderPage. */
export const deckTitles = (lang: Lang) => deckText[lang]

export const notFoundBody = (lang: Lang) =>
  html`<h1>${deckText[lang].notFound}</h1>
    <p><a href="/slides">${deckText[lang].decks}</a></p>`

const date = (seconds: number | null) =>
  seconds === null ? '' : new Date(seconds * 1000).toISOString()

function filesCell(entry: HistoryEntry, lang: Lang) {
  const t = deckText[lang]
  const { files } = entry
  const missing = files.missing.length
    ? html`<details>
        <summary>
          ${t.missing(files.missing.length + files.missingNotShown)}
        </summary>
        <ul>
          ${files.missing.map((path) => html`<li><code>${path}</code></li>`)}
        </ul>
        ${files.missingNotShown ? html`<p>${t.more(files.missingNotShown)}</p>` : ''}
      </details>`
    : ''
  return html`${files.received} / ${files.total}${missing}`
}

const deletionSection = (deck: string, lang: Lang) => {
  const t = deckText[lang]
  return html`<h2>${t.deleteHeading}</h2>
    <p>${t.deleteNote}</p>
    <form method="post" action="/slides/${deck}/delete">
      <label
        >${t.deleteConfirm(html`<code>${deck}</code>`)}
        <input name="confirm" autocomplete="off" required
      /></label>
      <button type="submit">${t.delete}</button>
    </form>`
}

export const deletionMismatchBody = (deck: string, lang: Lang) =>
  html`<h1>${deckText[lang].deleteFailedTitle}</h1>
    <p>${deckText[lang].deleteMismatch}</p>
    <p><a href="/slides/${deck}">${deckText[lang].backToDeck}</a></p>`

export function historyBody(
  deck: string,
  entries: readonly HistoryEntry[],
  olderCursor: string | null,
  publication: PanelView,
  lang: Lang,
): Html {
  const t = deckText[lang]
  const rows = entries.map(
    (entry) =>
      html`<tr>
        <td>
          <code>${entry.commit.slice(0, 12)}</code><br /><code
            >${entry.ref}</code
          >
        </td>
        <td>
          ${stateLabel(entry.state, lang)}
          ${
            entry.failureReason
              ? html`<div class="reason">
                  ${reasonLabel(entry.failureReason, lang)}
                </div>`
              : ''
          }
        </td>
        <td>${filesCell(entry, lang)}</td>
        <td>${date(entry.createdAt)}</td>
        <td><code>${entry.deploymentId}</code></td>
        <td>${deploymentActions(deck, publication, entry, lang)}</td>
      </tr>`,
  )
  return html`<p><a href="/slides">${t.decks}</a></p>
    <h1>${deck}</h1>
    ${publicationPanel(deck, publication, lang)} ${manageLink(deck, lang)}
    <h2>${t.history}</h2>
    ${
      publication.delivery
        ? html`<p>${t.historyNoteDelivery}</p>`
        : html`<p>${t.historyNote}</p>`
    }
    <table>
      <tr>
        <th>commit / ref</th>
        <th>${t.columns.state}</th>
        <th>${t.columns.files}</th>
        <th>${t.columns.started}</th>
        <th>deployment</th>
        <th>${t.columns.publish}</th>
      </tr>
      ${
        rows.length
          ? rows
          : html`<tr>
              <td colspan="6">${t.noVersions}</td>
            </tr>`
      }
    </table>
    ${
      olderCursor
        ? html`<p>
            <a href="/slides/${deck}?before=${encodeURIComponent(olderCursor)}"
              >${t.older}</a
            >
          </p>`
        : ''
    }
    ${deletionSection(deck, lang)}`
}
