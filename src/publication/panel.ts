import { html } from 'hono/html'
import type { HistoryEntry } from '../decks/history'
import { dayFormats } from '../share/dates'
import { messages, type Lang } from '../site/i18n'
import type { DeckPublication } from './state'
import type { PointedVersion } from './store'
import type { Takedown } from './takedown'

/** What the deck page shows about publication. */
export type PanelView = Readonly<{
  state: DeckPublication
  /** An operator's takedown, shown with its reason while it lasts. */
  takedown: Takedown | null
  /** The public deployment, or the one a resume brings back. */
  pointed: PointedVersion | null
  /** The newest received version, which publishing offers when nothing is. */
  latest: PointedVersion | null
  result: ResultMessage | null
  /** Whether a content origin is configured, so versions can be opened. */
  delivery: boolean
}>

const resultKinds = [
  'applied',
  'unchanged',
  'conflict',
  'not_paused',
  'not_publishable',
  'hidden',
  'invalid',
] as const
/** Outcomes of a publication form, shown once after the redirect. */
export type ResultMessage = (typeof resultKinds)[number]

export function parseResult(value: string | undefined): ResultMessage | null {
  return (resultKinds as readonly (string | undefined)[]).includes(value)
    ? (value as ResultMessage)
    : null
}

export const panelText = messages({
  ja: {
    results: {
      applied: '操作を反映しました。',
      unchanged: 'すでにその状態です。',
      conflict:
        '画面を開いた後に公開状態が変わったため、反映しませんでした。現在の状態を確認して選び直してください。',
      not_paused: '停止中ではないため、再開しませんでした。',
      not_publishable:
        'この版は公開できません。このスライドの受け取り済みの版だけを選べます。',
      hidden:
        '運営がこのスライドを非表示にしているため、公開状態を変えられません。',
      invalid: '操作の内容が正しくありません。',
    },
    takedown: {
      title: '運営がこのスライドを非表示にしています。',
      body: '共有 URL、配信、表紙、一覧のすべてで、誰にも表示されません。非表示の間は、公開の状態を変えられません。',
      reason: '理由',
      at: '日時',
    },
    states: {
      draft: 'まだ公開していません',
      public: '公開中',
      paused: '公開を止めています',
    },
    stateNotes: {
      draft: 'いまはあなただけが見られます。',
      public: '読者が開けます。',
      paused: '読者は開けません。',
    },
    pauseNote:
      '止めると、読者は開けなくなります。もう一度公開すると、同じ URL で開けます。',
    nothingToPublish: 'スライドを置くと、公開できます。',
    section: '公開',
    noDelivery:
      '配信ドメインが未設定のため、スライドを開くことも、読者が開くこともまだできません。公開の状態の切り替えだけを記録します。',
    resume: 'もう一度公開する',
    pause: '公開を止める',
    publishNow: '公開する',
    viewInViewer: 'viewer で見る',
  },
  en: {
    results: {
      applied: 'Your change was applied.',
      unchanged: 'It is already in that state.',
      conflict:
        'Nothing was changed: the publication changed after you opened this page. Check the current state and choose again.',
      not_paused: 'Nothing was resumed: publishing is not paused.',
      not_publishable:
        'This version cannot be published. Only versions of these slides that were put up can be chosen.',
      hidden:
        'Nothing was changed: the operator has hidden these slides, so their publication cannot be changed.',
      invalid: 'The request was not valid.',
    },
    takedown: {
      title: 'The operator has hidden these slides.',
      body: 'Nobody can see them at the share URL, on their own origin, as a cover, or in any list. Publishing cannot be changed while they are hidden.',
      reason: 'Reason',
      at: 'Since',
    },
    states: {
      draft: 'Not published yet',
      public: 'Public',
      paused: 'Publishing is stopped',
    },
    stateNotes: {
      draft: 'Only you can see them for now.',
      public: 'Readers can open them.',
      paused: 'Readers cannot open them.',
    },
    pauseNote:
      'Readers will no longer be able to open them. Publish again and they open at the same URL.',
    nothingToPublish: 'Drop your slides to be able to publish them.',
    section: 'Publishing',
    noDelivery:
      'The content domain is not set up, so the slides cannot be opened yet, by you or by readers. Only the change of publishing is recorded.',
    resume: 'Publish again',
    pause: 'Stop publishing',
    publishNow: 'Publish',
    viewInViewer: 'View in viewer',
  },
})

type PanelText = (typeof panelText)[Lang]

/** The deployment the deck points to: public, or restored on resume. */
export function pointedId(deck: DeckPublication): string | null {
  const { publication } = deck
  if (publication.kind === 'public') return publication.deploymentId
  return publication.kind === 'paused' ? publication.resumeTo : null
}

export const publicationAction = (deck: string) => `/slides/${deck}/publication`

const resultClass = (result: ResultMessage) =>
  result === 'applied' || result === 'unchanged'
    ? 'notice-success'
    : 'notice-danger'

function takedownNotice(t: PanelText, takedown: Takedown, lang: Lang) {
  const at = new Date(takedown.hiddenAt * 1000)
  return html`<div class="notice-danger" role="alert">
    <p>
      <strong class="status-chip status-hidden">${t.takedown.title}</strong>
    </p>
    <p>${t.takedown.body}</p>
    <p>${t.takedown.reason}: ${takedown.reason}</p>
    <p>
      ${t.takedown.at}:
      <time datetime="${at.toISOString()}">${dayFormats[lang].format(at)}</time>
    </p>
  </div>`
}

export function hiddenRevision(deck: DeckPublication) {
  return html`<input
    type="hidden"
    name="expectedRevision"
    value="${deck.revision}"
  />`
}

/** What the publish button of the frame publishes, if anything is to be. */
function publishTarget(view: PanelView): PointedVersion | null {
  const { publication } = view.state
  if (publication.kind === 'draft') return view.latest
  return publication.kind === 'paused' && publication.resumeTo === null
    ? view.latest
    : null
}

function publicationForm(deckId: string, view: PanelView, t: PanelText) {
  const deck = view.state
  switch (deck.publication.kind) {
    case 'public':
      return html`<form method="post" action="${publicationAction(deckId)}">
        ${hiddenRevision(deck)}
        <input type="hidden" name="action" value="pause" />
        <button class="button-secondary" aria-describedby="pause-note">
          ${t.pause}
        </button>
        <p class="field-note" id="pause-note">${t.pauseNote}</p>
      </form>`
    case 'paused':
      if (deck.publication.resumeTo !== null)
        return html`<form method="post" action="${publicationAction(deckId)}">
          ${hiddenRevision(deck)}
          <input type="hidden" name="action" value="resume" />
          <button class="button-primary">${t.resume}</button>
        </form>`
  }
  const target = publishTarget(view)
  return target
    ? html`<form method="post" action="${publicationAction(deckId)}">
        ${hiddenRevision(deck)}
        <input type="hidden" name="action" value="publish" />
        <input
          type="hidden"
          name="deploymentId"
          value="${target.deploymentId}"
        />
        <button class="button-primary">${t.publishNow}</button>
      </form>`
    : html`<p class="field-note">${t.nothingToPublish}</p>`
}

/**
 * The publication frame of a slide's page: its heading, the one sentence
 * that says what readers can do now, and the one button that changes it.
 * Publishing is manual; the page offers no other mode.
 */
export function publicationPanel(deckId: string, view: PanelView, lang: Lang) {
  const t = panelText[lang]
  const kind = view.state.publication.kind
  return html`<section
    class="panel"
    data-deck-frame="publication"
    aria-labelledby="publication-heading"
  >
    <h2 id="publication-heading">${t.section}</h2>
    ${
      view.result
        ? html`<p class="${resultClass(view.result)}" role="status">
            ${t.results[view.result]}
          </p>`
        : ''
    }
    ${view.takedown ? takedownNotice(t, view.takedown, lang) : ''}
    ${
      view.delivery
        ? ''
        : html`<p class="notice-warning" role="note">${t.noDelivery}</p>`
    }
    ${
      view.takedown
        ? ''
        : html`<div class="publication-state">
              <span class="status-chip status-${kind}">${t.states[kind]}</span>
              <span class="field-note">${t.stateNotes[kind]}</span>
            </div>
            ${publicationForm(deckId, view, t)}`
    }
  </section>`
}

/**
 * The button that opens one ready version as its author, in a new tab.
 * Until the viewer shows author-only versions, this is the author-only
 * session that the viewer will replace.
 */
export function previewForm(
  deckId: string,
  deploymentId: string,
  label: string,
) {
  return html`<form
    method="post"
    action="/slides/${deckId}/deployments/${deploymentId}/preview"
    target="_blank"
  >
    <button class="button-secondary">${label}</button>
  </form>`
}
