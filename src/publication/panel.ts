import { html } from 'hono/html'
import type { HistoryEntry } from '../decks/history'
import type { DeckPublication } from './state'
import type { PointedVersion } from './store'

/** What the deck page shows about publication. */
export type PanelView = Readonly<{
  state: DeckPublication
  /** The public deployment, or the one a resume brings back. */
  pointed: PointedVersion | null
  result: ResultMessage | null
  /** Whether a content origin is configured, so versions can be opened. */
  delivery: boolean
  /** The share URL readers open, while the deck is public and delivered. */
  shareUrl: string | null
}>

/** Outcomes of a publication form, shown once after the redirect. */
export const resultMessages = {
  applied: '操作を反映しました。',
  unchanged: 'すでにその状態です。',
  conflict:
    '画面を開いた後に公開状態が変わったため、反映しませんでした。現在の状態を確認して選び直してください。',
  not_paused: '停止中ではないため、再開しませんでした。',
  not_publishable:
    'この版は公開できません。このデッキの受領完了の版だけを選べます。',
  invalid: '操作の内容が正しくありません。',
} as const
export type ResultMessage = keyof typeof resultMessages

export function parseResult(value: string | undefined): ResultMessage | null {
  return value !== undefined && Object.hasOwn(resultMessages, value)
    ? (value as ResultMessage)
    : null
}

const modeLabels = {
  manual: '手動公開（CI は下書きだけを作る）',
  repository: 'リポジトリ設定に従う（CI の published を反映する）',
} as const

/** The deployment the deck points to: public, or restored on resume. */
export function pointedId(deck: DeckPublication): string | null {
  const { publication } = deck
  if (publication.kind === 'public') return publication.deploymentId
  return publication.kind === 'paused' ? publication.resumeTo : null
}

const short = (commit: string) => commit.slice(0, 12)

function stateText(view: PanelView) {
  const { publication } = view.state
  // A commit can be uploaded more than once, so the deployment ID names
  // the history row.
  const commit = view.pointed
    ? html`<code>${short(view.pointed.commit)}</code>（deployment
        <code>${view.pointed.deploymentId}</code>）`
    : ''
  switch (publication.kind) {
    case 'draft':
      return html`下書きのみ（一般公開していません）`
    case 'public':
      return html`一般公開中: ${commit}`
    case 'paused':
      return publication.resumeTo
        ? html`公開停止中（再開すると ${commit}を一般公開します）`
        : html`公開停止中（再開しても下書きのままです）`
  }
}

const action = (deck: string) => `/decks/${deck}/publication`

function hiddenRevision(deck: DeckPublication) {
  return html`<input
    type="hidden"
    name="expectedRevision"
    value="${deck.revision}"
  />`
}

/** Current state, pause/resume, and mode controls above the history. */
export function publicationPanel(deckId: string, view: PanelView) {
  const deck = view.state
  const paused = deck.publication.kind === 'paused'
  const otherMode = deck.mode === 'manual' ? 'repository' : 'manual'
  const pauseNote =
    deck.publication.kind === 'public'
      ? '停止すると匿名の読者は開けなくなり、作者限定の閲覧も開き直しが必要になります。CI からも再開まで公開されません。'
      : '停止すると作者限定の閲覧も開き直しが必要になり、再開するまで CI からも公開されません。'
  return html`<section aria-label="公開状態">
    ${view.result ? html`<p role="status">${resultMessages[view.result]}</p>` : ''}
    ${
      view.delivery
        ? ''
        : html`<p role="note">
            配信ドメインが未設定のため、作者限定で開くことも、一般公開した版を読者が開くこともまだできません。公開状態の切り替えだけを記録します。
          </p>`
    }
    <p>${stateText(view)}</p>
    ${
      view.shareUrl
        ? html`<p>
            <label for="share-url">共有 URL</label>
            <input
              id="share-url"
              readonly
              style="width: 24em; max-width: 100%; box-sizing: border-box"
              value="${view.shareUrl}"
            />
            <button type="button" data-copy="share-url">リンクをコピー</button>
            <a href="${view.shareUrl}">開く</a>
          </p>`
        : ''
    }
    <p>公開モード: ${modeLabels[deck.mode]}</p>
    <form method="post" action="${action(deckId)}">
      ${hiddenRevision(deck)}
      ${
        paused
          ? html`<input type="hidden" name="action" value="resume" />
              <button>公開を再開する</button>`
          : html`<input type="hidden" name="action" value="pause" />
              <button aria-describedby="pause-note">公開を停止する</button>
              <small id="pause-note">${pauseNote}</small>`
      }
    </form>
    <form method="post" action="${action(deckId)}">
      ${hiddenRevision(deck)}
      <input type="hidden" name="action" value="set_mode" />
      <input type="hidden" name="mode" value="${otherMode}" />
      <button aria-describedby="mode-note">
        ${modeLabels[otherMode]}に切り替える
      </button>
      <small id="mode-note"
        >${
          otherMode === 'repository'
            ? 'CI の published: false は公開中の版も取り下げます。更新を下書きに置くだけなら手動公開のままにしてください。'
            : '手動公開では CI は下書きだけを作り、公開する版は作者が選びます。'
        }</small
      >
    </form>
  </section>`
}

/** What publishing this version does to the current publication. */
function publishNote(view: PanelView, entry: HistoryEntry) {
  const { publication } = view.state
  const pointed = view.pointed
  if (publication.kind === 'paused')
    return '停止を解除して、この版を一般公開します。'
  if (publication.kind !== 'public' || !pointed) return null
  const direction =
    entry.createdAt < pointed.createdAt
      ? `公開中の ${short(pointed.commit)} より古い版に差し戻します。`
      : `公開中の ${short(pointed.commit)} をこの版に更新します。`
  return `${direction}公開中の版は置き換わり、その URL では開けなくなります。発表中なら発表後に操作してください。`
}

/** Owner-only view and publish actions for one ready deployment. */
export function deploymentActions(
  deckId: string,
  view: PanelView,
  entry: HistoryEntry,
) {
  if (entry.state !== 'ready') return ''
  const commit = short(entry.commit)
  const open = view.delivery
    ? html`<form
        method="post"
        action="/decks/${deckId}/deployments/${entry.deploymentId}/preview"
        target="_blank"
      >
        <button aria-label="${commit} を作者限定で新しい tab に開く">
          作者限定で開く
        </button>
      </form>`
    : ''
  const { publication } = view.state
  if (
    publication.kind === 'public' &&
    publication.deploymentId === entry.deploymentId
  )
    return html`<strong>一般公開中</strong>${open}`
  const resumes =
    publication.kind === 'paused' && publication.resumeTo === entry.deploymentId
  const note = publishNote(view, entry)
  const noteId = `publish-note-${entry.deploymentId}`
  return html`${resumes ? html`<strong>再開すると公開</strong>` : ''}${open}
    <form method="post" action="${action(deckId)}">
      ${hiddenRevision(view.state)}
      <input type="hidden" name="action" value="publish" />
      <input type="hidden" name="deploymentId" value="${entry.deploymentId}" />
      <button
        aria-label="${commit} を一般公開する"
        ${note ? html`aria-describedby="${noteId}"` : ''}
      >
        この版を一般公開する
      </button>
      ${note ? html`<small id="${noteId}">${note}</small>` : ''}
    </form>`
}
