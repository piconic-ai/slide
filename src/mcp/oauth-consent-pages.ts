import { SERVICE_NAME } from '../site/service'
import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'
import { PLAIN_PAGE_POLICY } from '../site/shell'
import { fieldsOf, type AuthorizationRequest } from './authorization'
import { isLoopback } from './client-registration'
import { AUTHORIZE_PATH } from './oauth-metadata'

const text = messages({
  ja: {
    title: 'エージェントとの接続',
    heading: 'エージェントとの接続を許可しますか',
    claimedName: 'エージェントが名乗っている名前',
    returnTo: '許可したあとの戻り先',
    can: 'このエージェントは、次のことができます。',
    mayPut: 'あなたのスライドを置く、差し替える',
    mayExport: '自分のスライドと記事を読み、取り出す',
    cannot: '公開はできません。',
    compare: `名前は、エージェントが自分で付けたもので、${SERVICE_NAME} は確かめていません。戻り先が、あなたが使っているエージェントのものかを確かめてください。`,
    loopback:
      '戻り先は、このコンピューターで動いているアプリです。自分で始めた接続でなければ、許可しないでください。',
    signedInAs: (login: string) => `@${login} としてログイン中です。`,
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
      invalid_request:
        'エージェントの要求が正しくありません。エージェントから、もう一度接続を始めてください。',
      unsupported_response_type:
        'エージェントの要求が、この接続の方式に合っていません。エージェントから、もう一度接続を始めてください。',
      invalid_target:
        'エージェントが、このサービスではない接続先を指定しています。接続は行いません。',
    },
  },
  en: {
    title: 'Connect an agent',
    heading: 'Allow this agent to connect?',
    claimedName: 'The name the agent gives itself',
    returnTo: 'Where allowing takes you back to',
    can: 'This agent can do the following.',
    mayPut: 'Put up your slides and replace them',
    mayExport: 'Read your slides and articles, and take them out',
    cannot: 'It cannot publish them.',
    compare: `The agent chose its name itself; ${SERVICE_NAME} has not checked it. Make sure the place it returns to belongs to the agent you are using.`,
    loopback:
      'That is an app running on this computer. If you did not start this connection yourself, do not allow it.',
    signedInAs: (login: string) => `Signed in as @${login}.`,
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
      invalid_request:
        'The agent’s request is not valid. Start the connection again from your agent.',
      unsupported_response_type:
        'The agent asked for a kind of connection this service does not offer. Start the connection again from your agent.',
      invalid_target:
        'The agent named a server other than this service. Nothing was connected.',
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
  return html`<h1>${t.heading}</h1>
    <p>${t.can}</p>
    <ul>
      <li>${t.mayPut}</li>
      <li>${t.mayExport}</li>
    </ul>
    <p>${t.cannot}</p>
    <p>
      ${t.claimedName}<br />
      <strong>${request.clientName}</strong>
    </p>
    <p>
      ${t.returnTo}<br />
      <strong>${target.host}</strong>
    </p>
    <p>${t.compare}</p>
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
