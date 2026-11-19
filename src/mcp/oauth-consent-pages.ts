import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'
import { PLAIN_PAGE_POLICY } from '../site/shell'
import { fieldsOf, type AuthorizationRequest } from './authorization'
import { isLoopback } from './client-registration'
import { AUTHORIZE_PATH } from './oauth-metadata'

const text = messages({
  ja: {
    title: 'エージェントとの接続',
    heading: (name: string) => `${name} との接続を許可しますか`,
    can: 'このエージェントは、あなたのスライドを置くことと、差し替えることができます。公開はできません。',
    returnsTo: (host: string) => `許可すると、${host} に戻ります。`,
    loopback:
      '戻り先は、このコンピューターで動いているアプリです。自分で始めた接続でなければ、許可しないでください。',
    signedInAs: (login: string) => `GitHub の ${login} としてログイン中です。`,
    revocable:
      '接続は、設定の「AI エージェントから置く」で、いつでも取り消せます。',
    allow: '許可する',
    deny: '許可しない',
    failedTitle: '接続を始められません',
    failures: {
      missing:
        '接続の要求が見つかりません。エージェントから、もう一度接続を始めてください。',
      unknown_client:
        'このエージェントは登録されていません。エージェントから、もう一度接続を始めてください。',
      redirect_uri:
        'エージェントが指定した戻り先が、登録されたものと違います。接続は行いません。',
      no_handle:
        'ハンドルがまだ決まっていないため、接続できません。設定でハンドルを確かめてください。',
    },
  },
  en: {
    title: 'Connect an agent',
    heading: (name: string) => `Allow ${name} to connect?`,
    can: 'This agent can put up your slides and replace them. It cannot publish them.',
    returnsTo: (host: string) => `Allowing takes you back to ${host}.`,
    loopback:
      'That is an app running on this computer. If you did not start this connection yourself, do not allow it.',
    signedInAs: (login: string) => `Signed in as ${login} on GitHub.`,
    revocable:
      'You can end the connection at any time under “Put slides up from an AI agent” in the settings.',
    allow: 'Allow',
    deny: 'Don’t allow',
    failedTitle: 'The connection cannot start',
    failures: {
      missing:
        'There is no connection request. Start the connection again from your agent.',
      unknown_client:
        'This agent is not registered. Start the connection again from your agent.',
      redirect_uri:
        'The agent asked to return somewhere it did not register. Nothing was connected.',
      no_handle:
        'You have no handle yet, so an agent cannot connect. Check your handle in the settings.',
    },
  },
})

export type ConsentFailure = keyof (typeof text)['ja']['failures']

export const consentTitle = (lang: Lang) => text[lang].title
export const consentFailedTitle = (lang: Lang) => text[lang].failedTitle

/**
 * The policy of the page that asks. Its form posts to the service, which
 * answers by redirecting to the client; browsers hold that redirect to
 * `form-action` too, so the client's origin is named, and nothing else.
 */
export const consentPolicy = (redirectUri: string) =>
  PLAIN_PAGE_POLICY.replace(
    "form-action 'none'",
    `form-action 'self' ${new URL(redirectUri).origin}`,
  )

/**
 * Asks the author whether an agent may connect. The page says in one
 * sentence what that allows, and names the host the answer goes to, with a
 * warning when that host is this computer, which any local app can claim.
 */
export function consentBody(
  request: AuthorizationRequest,
  login: string,
  lang: Lang,
) {
  const t = text[lang]
  const target = new URL(request.redirectUri)
  return html`<h1>${t.heading(request.clientName)}</h1>
    <p>${t.can}</p>
    <p>${t.returnsTo(target.host)}</p>
    ${isLoopback(target) ? html`<p>${t.loopback}</p>` : ''}
    <p class="field-note">${t.signedInAs(login)} ${t.revocable}</p>
    <form method="post" action="${AUTHORIZE_PATH}">
      ${Object.entries(fieldsOf(request)).map(
        ([name, value]) =>
          html`<input type="hidden" name="${name}" value="${value}" />`,
      )}
      <p class="choice-row">
        <button class="button-primary" name="decision" value="allow">
          ${t.allow}
        </button>
        <button class="button-secondary" name="decision" value="deny">
          ${t.deny}
        </button>
      </p>
    </form>`
}

export const consentFailureBody = (failure: ConsentFailure, lang: Lang) =>
  html`<h1>${text[lang].failedTitle}</h1>
    <p>${text[lang].failures[failure]}</p>`
