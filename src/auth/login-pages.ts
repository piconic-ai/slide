import { SERVICE_NAME } from '../site/service'
import { html } from 'hono/html'
import { CODE_ATTEMPTS, CODE_LENGTH, CODE_SECONDS } from './login-policy'
import type { SignupMode } from './signup-mode'
import { handleRefusalText, type HandleProblem } from '../handles/refusals'
import { messages, type Lang } from '../site/i18n'
import { prefixedField } from '../site/prefixed-field'
import { pageShell } from '../site/shell'

const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

/**
 * The login and welcome pages' policy. Turnstile's script and frame are
 * allowed only when a site key is set, and only on these pages.
 */
export const loginPolicy = (turnstile: boolean): string => {
  const extra = turnstile ? ` ${TURNSTILE_ORIGIN}` : ''
  return [
    `default-src 'none'`,
    `script-src 'self'${extra}`,
    `connect-src 'self'${extra}`,
    `img-src 'self'`,
    `frame-src ${turnstile ? TURNSTILE_ORIGIN : `'none'`}`,
    `style-src 'unsafe-inline'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ')
}

const text = messages({
  ja: {
    loginTitle: 'ログイン',
    loginIntro:
      'メールアドレスに 6 桁のコードを送ります。パスワードは使いません。いまは招待制で、運営が登録したメールアドレスでだけログインできます。',
    loginIntroOpen:
      'メールアドレスに 6 桁のコードを送ります。パスワードは使いません。はじめての方は、コードを入力したあと、利用規約に同意して登録します。',
    email: 'メールアドレス',
    botCheck: 'ボットでないことの確認',
    sendCode: 'コードを送る',
    loginNote:
      'メールアドレスは、ほかの人には見えません。メールが届かない場合は、迷惑メールフォルダもご確認ください。',
    invalidEmail: 'メールアドレスの形式が正しくありません。',
    botFailed:
      'ボットでないことを確認できませんでした。もう一度お試しください。',
    notConfigured:
      'いま、メールを送れません。しばらくしてからもう一度お試しください。',
    limited: (when: string) =>
      `コードの送信が多すぎます。${when} 以降に、もう一度お試しください。`,
    busy: 'ログインのコードの送信が集中しています。しばらくしてからやり直してください。',
    codeTitle: 'コードを入力',
    codeSent: (email: string) =>
      `${email} 宛てに、6 桁のコードを送りました。有効期限は ${CODE_SECONDS / 60} 分です。`,
    code: 'コード',
    login: 'ログイン',
    resend: 'コードを送り直す',
    changeEmail: 'メールアドレスを変える',
    codeNote: `メールが届かない場合は、迷惑メールフォルダもご確認ください。入力を ${CODE_ATTEMPTS} 回間違えるとコードは無効になるので、送り直してください。`,
    wrongCode: (left: number | null) =>
      left === null
        ? 'コードが違います。もう一度入力してください。'
        : `コードが違います。もう一度入力してください。残り ${left} 回です。`,
    deadCode: 'このコードは使えなくなりました。コードを送り直してください。',
    welcomeTitle: 'はじめに',
    welcomeIntro: 'スライドの URL と、プロフィールに出る名前を決めます。',
    handle: 'ハンドル',
    handleNote:
      'あとから変えられません。英小文字、数字、- が使えます(1〜39 文字、- で始まらない)。',
    displayName: '表示名',
    displayNameNote: '50 文字までです。',
    start: 'はじめる',
    terms: '利用規約',
    privacy: 'プライバシーポリシー',
    readFirst: (terms: Html, privacy: Html) =>
      html`ご利用の前に、${terms}と${privacy}をご確認ください。`,
    agree: (terms: Html, privacy: Html) =>
      html`${terms}と${privacy}に同意します。`,
    startNote: '同意すると、「はじめる」を押せます。',
    termsRefused: '利用規約とプライバシーポリシーに同意してください。',
    leave: '登録せずに終了する',
    leaveNote: '終了すると、入力されたメールアドレスを削除します。',
    nameEmpty: '表示名を入力してください。',
    nameTooLong: '表示名は 50 文字までです。',
  },
  en: {
    loginTitle: 'Sign in',
    loginIntro:
      'We send a 6-digit code to your email address. There is no password. For now, signing in is by invitation: only email addresses the operator registered can sign in.',
    loginIntroOpen:
      'We send a 6-digit code to your email address. There is no password. If this is your first time, you sign up after you enter the code, by agreeing to the terms.',
    email: 'Email address',
    botCheck: 'Check that you are not a bot',
    sendCode: 'Send the code',
    loginNote:
      'Your email address is not shown to anyone else. If the email does not arrive, check your spam folder.',
    invalidEmail: 'That does not look like an email address.',
    botFailed: 'We could not check that you are not a bot. Please try again.',
    notConfigured: 'We cannot send email right now. Please try again later.',
    limited: (when: string) =>
      `Too many codes were asked for. Please try again after ${when}.`,
    busy: 'Too many sign-in codes are being sent right now. Please try again in a while.',
    codeTitle: 'Enter the code',
    codeSent: (email: string) =>
      `We sent a 6-digit code to ${email}. It expires in ${CODE_SECONDS / 60} minutes.`,
    code: 'Code',
    login: 'Sign in',
    resend: 'Send the code again',
    changeEmail: 'Use another email address',
    codeNote: `If the email does not arrive, check your spam folder. A code stops working after ${CODE_ATTEMPTS} wrong tries, so send it again.`,
    wrongCode: (left: number | null) =>
      left === null
        ? 'That code is wrong. Please try again.'
        : `That code is wrong. Please try again. ${left} ${left === 1 ? 'try' : 'tries'} left.`,
    deadCode: 'This code no longer works. Please send the code again.',
    welcomeTitle: 'Welcome',
    welcomeIntro:
      'Choose the URL of your slides and the name your profile shows.',
    handle: 'Handle',
    handleNote:
      'It cannot be changed later. Lowercase letters, digits and - are allowed (1 to 39 characters, not starting with -).',
    displayName: 'Display name',
    displayNameNote: 'Up to 50 characters.',
    start: 'Get started',
    terms: 'Terms of Service',
    privacy: 'Privacy Policy',
    readFirst: (terms: Html, privacy: Html) =>
      html`Before you use ${SERVICE_NAME}, please read the ${terms} and the
      ${privacy}.`,
    agree: (terms: Html, privacy: Html) =>
      html`I agree to the ${terms} and the ${privacy}.`,
    startNote: 'Once you agree, you can press "Get started".',
    termsRefused:
      'Please agree to the Terms of Service and the Privacy Policy.',
    leave: 'Leave without signing up',
    leaveNote: 'If you leave now, the email address you entered is deleted.',
    nameEmpty: 'Enter a display name.',
    nameTooLong: 'A display name is 50 characters at most.',
  },
})

const pageStyleOf = html`<style>
  .login-page {
    max-width: 480px;
    margin: 0 auto;
  }
  .login-page h1 {
    margin-bottom: 8px;
  }
  .login-page .field {
    margin: 0 0 20px;
  }
  .login-page .field label {
    margin: 0 0 6px;
  }
  .login-page .field-note {
    margin-top: 6px;
  }
  .login-page form > button {
    margin-top: 4px;
  }
  .login-page .button-primary:disabled {
    border-color: var(--border);
    background: var(--secondary);
    color: var(--muted-foreground);
    cursor: not-allowed;
  }
  .login-page .terms-link {
    font-weight: 700;
    text-decoration: underline;
  }
  .login-page .terms-note {
    margin-top: 12px;
  }
  .login-page .agree {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 0 0 8px;
    font-weight: 400;
  }
  .login-page .agree input {
    flex: none;
    width: 20px;
    height: 20px;
    min-height: 0;
    margin: 4px 0 0;
  }
  .login-page .leave {
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
  }
  .login-page .leave form {
    margin: 0 0 4px;
  }
  .login-page .field-error {
    margin: 8px 0 0;
  }
  /* The notice above the form is as wide as the fields under it, and sits
     the same distance from the text above as from the form below. */
  .login-page > .notice-danger {
    box-sizing: border-box;
    max-width: 28em;
    margin: 16px 0 20px;
  }
  .login-page .secondary-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 24px;
    margin: 0 0 16px;
  }
  .login-page .secondary-actions .tap-area,
  .login-page .link-button {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    font-size: 16px;
  }
  .login-page .secondary-actions form {
    margin: 0;
  }
  .login-page .cf-turnstile {
    margin: 0 0 20px;
  }
  .login-page .link-button {
    min-height: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
</style>`

/** What a sign-in carries along to the page it ends on. */
export type Carry = Readonly<{ to?: string; drop?: string }>

const carried = ({ to, drop }: Carry) =>
  html`${to ? html`<input type="hidden" name="to" value="${to}" />` : ''}${
    drop ? html`<input type="hidden" name="drop" value="${drop}" />` : ''
  }`

export type LoginProblem =
  | Readonly<{
      kind: 'invalid_email' | 'bot_failed' | 'not_configured' | 'busy'
    }>
  | Readonly<{ kind: 'limited'; retryAt: string }>

const problemText = (lang: Lang, problem: LoginProblem) => {
  const t = text[lang]
  switch (problem.kind) {
    case 'invalid_email':
      return t.invalidEmail
    case 'bot_failed':
      return t.botFailed
    case 'not_configured':
      return t.notConfigured
    case 'busy':
      return t.busy
    case 'limited':
      return t.limited(problem.retryAt)
  }
}

const frame = (
  lang: Lang,
  url: URL,
  title: string,
  body: ReturnType<typeof html>,
  account: 'shown' | 'none' = 'shown',
) =>
  pageShell({
    lang,
    title,
    url,
    account,
    width: 'narrow',
    pageClass: 'login-page',
    style: pageStyleOf,
    head: html`<meta name="robots" content="noindex" />`,
    body,
  })

type Html = ReturnType<typeof html>

/** The sentence that names the terms and the privacy policy, as two links. */
const termsLinks = (
  sentence: (terms: Html, privacy: Html) => Html,
  t: { terms: string; privacy: string },
) =>
  sentence(
    html`<a class="terms-link" href="/terms">${t.terms}</a>`,
    html`<a class="terms-link" href="/privacy">${t.privacy}</a>`,
  )

/** Turnstile's widget and script, or nothing where no site key is set. */
const turnstileWidget = (siteKey: string | undefined, label: string) =>
  siteKey
    ? html`<div
          class="cf-turnstile"
          data-sitekey="${siteKey}"
          aria-label="${label}"
        ></div>
        <script
          src="${TURNSTILE_ORIGIN}/turnstile/v0/api.js"
          async
          defer
        ></script>`
    : ''

/** The first step: the address to send the code to. */
export const loginPage = (
  lang: Lang,
  url: URL,
  input: Readonly<{
    carry: Carry
    email?: string
    problem?: LoginProblem
    /** Whether the page says that signing in is by invitation. */
    mode: SignupMode
    /** The Turnstile site key; no key, no widget. */
    siteKey?: string
  }>,
) => {
  const t = text[lang]
  return frame(
    lang,
    url,
    t.loginTitle,
    html`<h1>${t.loginTitle}</h1>
      <p class="field-note">
        ${input.mode === 'open' ? t.loginIntroOpen : t.loginIntro}
      </p>
      ${
        input.problem
          ? html`<p class="notice-danger" role="alert">
              ${problemText(lang, input.problem)}
            </p>`
          : ''
      }
      <form method="post" action="/login">
        ${carried(input.carry)}
        <div class="field">
          <label for="login-email">${t.email}</label>
          <input
            id="login-email"
            name="email"
            type="email"
            autocomplete="email"
            required
            maxlength="254"
            value="${input.email ?? ''}"
          />
        </div>
        ${turnstileWidget(input.siteKey, t.botCheck)}
        <button class="button-primary" type="submit">${t.sendCode}</button>
      </form>
      <p class="field-note">${t.loginNote}</p>
      <p class="field-note terms-note">${termsLinks(t.readFirst, t)}</p>`,
  )
}

export type CodeProblem =
  | Readonly<{ kind: 'wrong'; left: number | null }>
  | Readonly<{ kind: 'dead' }>

/** The second step: the code that was sent, "sent" whoever the address is. */
export const codePage = (
  lang: Lang,
  url: URL,
  input: Readonly<{
    carry: Carry
    email: string
    problem?: CodeProblem
    /** The Turnstile site key; sending again is checked like the first time. */
    siteKey?: string
  }>,
) => {
  const t = text[lang]
  return frame(
    lang,
    url,
    t.codeTitle,
    html`<h1>${t.codeTitle}</h1>
      <p class="field-note">${t.codeSent(input.email)}</p>
      ${
        input.problem
          ? html`<p class="notice-danger" role="alert">
              ${
                input.problem.kind === 'wrong'
                  ? t.wrongCode(input.problem.left)
                  : t.deadCode
              }
            </p>`
          : ''
      }
      <form method="post" action="/login/code">
        ${carried(input.carry)}
        <input type="hidden" name="email" value="${input.email}" />
        <div class="field">
          <label for="login-code">${t.code}</label>
          <input
            id="login-code"
            name="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            required
            pattern="[0-9]{${CODE_LENGTH}}"
            maxlength="${CODE_LENGTH}"
          />
        </div>
        <button class="button-primary" type="submit">${t.login}</button>
      </form>
      <div class="secondary-actions">
        <form method="post" action="/login">
          ${carried(input.carry)}
          <input type="hidden" name="email" value="${input.email}" />
          ${turnstileWidget(input.siteKey, t.botCheck)}
          <button class="link-button" type="submit">${t.resend}</button>
        </form>
        <a class="tap-area" href="/login${loginQuery(input.carry)}"
          >${t.changeEmail}</a
        >
      </div>
      <p class="field-note">${t.codeNote}</p>`,
  )
}

/** The query that carries a sign-in's destination, with its leading `?`. */
export function loginQuery({ to, drop }: Carry): string {
  const query = new URLSearchParams()
  if (to) query.set('to', to)
  if (drop) query.set('drop', drop)
  const text = query.toString()
  return text ? `?${text}` : ''
}

export type WelcomeProblem = Readonly<{
  handle?: HandleProblem
  name?: 'empty' | 'too_long'
  /** The box was not ticked. */
  terms?: true
}>

/** The first sign-in's page: the handle and the display name. */
export const welcomePage = (
  lang: Lang,
  url: URL,
  input: Readonly<{
    carry: Carry
    handle?: string
    displayName?: string
    problem?: WelcomeProblem
  }>,
) => {
  const t = text[lang]
  const { problem } = input
  const handleError = problem?.handle
    ? handleRefusalText(lang, problem.handle)
    : null
  const nameError = problem?.name
    ? problem.name === 'empty'
      ? t.nameEmpty
      : t.nameTooLong
    : null
  return frame(
    lang,
    url,
    t.welcomeTitle,
    html`<h1>${t.welcomeTitle}</h1>
      <p class="field-note">${t.welcomeIntro}</p>
      <form method="post" action="/welcome">
        ${carried(input.carry)}
        <div class="field">
          <label for="welcome-handle">${t.handle}</label>
          ${prefixedField(
            'slide.community/@',
            html`<input
              id="welcome-handle"
              name="handle"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              required
              maxlength="39"
              pattern="[a-z0-9][a-z0-9\\-]{0,38}"
              title="${t.handleNote}"
              aria-describedby="welcome-handle-note"
              value="${input.handle ?? ''}"
            />`,
          )}
          ${
            handleError
              ? html`<p class="notice-danger field-error" role="alert">
                  ${handleError}
                </p>`
              : ''
          }
          <p class="field-note" id="welcome-handle-note">${t.handleNote}</p>
        </div>
        <div class="field">
          <label for="welcome-name">${t.displayName}</label>
          <input
            id="welcome-name"
            name="name"
            autocomplete="nickname"
            required
            maxlength="50"
            aria-describedby="welcome-name-note"
            value="${input.displayName ?? ''}"
          />
          ${
            nameError
              ? html`<p class="notice-danger field-error" role="alert">
                  ${nameError}
                </p>`
              : ''
          }
          <p class="field-note" id="welcome-name-note">${t.displayNameNote}</p>
        </div>
        <div class="field">
          <label class="agree" for="welcome-terms">
            <input
              id="welcome-terms"
              name="terms"
              type="checkbox"
              value="on"
              data-terms
            />
            <span>${termsLinks(t.agree, t)}</span>
          </label>
          ${
            problem?.terms
              ? html`<p class="notice-danger field-error" role="alert">
                  ${t.termsRefused}
                </p>`
              : ''
          }
        </div>
        <button
          class="button-primary"
          type="submit"
          data-start
          data-start-note="${t.startNote}"
        >
          ${t.start}
        </button>
      </form>
      <div class="leave">
        <form method="post" action="/welcome/leave">
          <button class="link-button" type="submit">${t.leave}</button>
        </form>
        <p class="field-note">${t.leaveNote}</p>
      </div>
      <script src="/welcome.js" defer></script>`,
    // The header would say "sign in" to someone who is signed in, so it
    // shows no account area until they have finished here.
    'none',
  )
}
