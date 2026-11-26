import { html } from 'hono/html'
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
    noDelivery:
      '配信ドメインが未設定のため、スライドを開くことも、読者が開くこともまだできません。公開の状態の切り替えだけを記録します。',
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
    noDelivery:
      'The content domain is not set up, so the slides cannot be opened yet, by you or by readers. Only the change of publishing is recorded.',
  },
})

type PanelText = (typeof panelText)[Lang]

/** The deployment the deck points to: public, or restored on resume. */
export function pointedId(deck: DeckPublication): string | null {
  const { publication } = deck
  if (publication.kind === 'public') return publication.deploymentId
  return publication.kind === 'paused' ? publication.resumeTo : null
}

export const publicationAction = (deck: string) =>
  `/my/slides/${deck}/publication`

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

/**
 * What the slide frame says above its rows: the outcome of the last form,
 * the operator's takedown with its reason, and the warning that versions
 * cannot be opened while no content origin is set. Each shows only when it
 * applies.
 */
export function publicationNotices(view: PanelView, lang: Lang) {
  const t = panelText[lang]
  return html`${
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
  }`
}

/** A link to the viewer, styled as a button. */
export const viewerLink = (href: string, label: string) =>
  html`<a class="button-secondary" href="${href}">${label}</a>`
