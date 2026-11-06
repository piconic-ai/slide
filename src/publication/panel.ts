import { html } from 'hono/html'
import type { HistoryEntry } from '../decks/history'
import type { DeckPublication } from './state'

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

/** The deployment readers can open now, if any. */
const publicId = (deck: DeckPublication) =>
  deck.publication.kind === 'public' ? deck.publication.deploymentId : null

function stateText(deck: DeckPublication, commitOf: (id: string) => string) {
  const { publication } = deck
  switch (publication.kind) {
    case 'draft':
      return html`下書きのみ（一般公開していません）`
    case 'public':
      return html`一般公開中:
        <code>${commitOf(publication.deploymentId)}</code>`
    case 'paused':
      return publication.resumeTo
        ? html`公開停止中（再開すると
            <code>${commitOf(publication.resumeTo)}</code> を一般公開します）`
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
export function publicationPanel(
  deckId: string,
  deck: DeckPublication,
  entries: readonly HistoryEntry[],
  result: ResultMessage | null,
) {
  const commits = new Map(
    entries.map((entry) => [entry.deploymentId, entry.commit.slice(0, 12)]),
  )
  const commitOf = (id: string) => commits.get(id) ?? id
  const paused = deck.publication.kind === 'paused'
  const otherMode = deck.mode === 'manual' ? 'repository' : 'manual'
  return html`<section aria-label="公開状態">
    ${result ? html`<p role="status">${resultMessages[result]}</p>` : ''}
    <p>${stateText(deck, commitOf)}</p>
    <p>公開モード: ${modeLabels[deck.mode]}</p>
    <form method="post" action="${action(deckId)}">
      ${hiddenRevision(deck)}
      ${
        paused
          ? html`<input type="hidden" name="action" value="resume" />
              <button>公開を再開する</button>`
          : html`<input type="hidden" name="action" value="pause" />
              <button>公開を停止する</button>
              <small
                >停止すると匿名の読者は開けなくなり、作者限定の閲覧も開き直しが必要になります。CI
                からも再開まで公開されません。</small
              >`
      }
    </form>
    <form method="post" action="${action(deckId)}">
      ${hiddenRevision(deck)}
      <input type="hidden" name="action" value="set_mode" />
      <input type="hidden" name="mode" value="${otherMode}" />
      <button>${modeLabels[otherMode]}に切り替える</button>
    </form>
  </section>`
}

/** Owner-only view and publish actions for one ready deployment. */
export function deploymentActions(
  deckId: string,
  deck: DeckPublication,
  entry: HistoryEntry,
) {
  if (entry.state !== 'ready') return ''
  const current = publicId(deck)
  const isCurrent = current === entry.deploymentId
  const open = html`<form
    method="post"
    action="/decks/${deckId}/deployments/${entry.deploymentId}/preview"
    target="_blank"
  >
    <button>作者限定で開く</button>
  </form>`
  if (isCurrent) return html`<strong>一般公開中</strong>${open}`
  return html`${open}
    <form method="post" action="${action(deckId)}">
      ${hiddenRevision(deck)}
      <input type="hidden" name="action" value="publish" />
      <input type="hidden" name="deploymentId" value="${entry.deploymentId}" />
      <button>この版を一般公開する</button>
      ${
        current
          ? html`<small
              >公開中の版は置き換わり、その URL
              では開けなくなります。発表中なら発表後に操作してください。</small
            >`
          : ''
      }
    </form>`
}
