import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import type { HistoryEntry } from '../decks/history'
import { messages, type Lang } from '../site/i18n'
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

const resultKinds = [
  'applied',
  'unchanged',
  'conflict',
  'not_paused',
  'not_publishable',
  'invalid',
] as const
/** Outcomes of a publication form, shown once after the redirect. */
export type ResultMessage = (typeof resultKinds)[number]

export function parseResult(value: string | undefined): ResultMessage | null {
  return (resultKinds as readonly (string | undefined)[]).includes(value)
    ? (value as ResultMessage)
    : null
}

type Markup = HtmlEscapedString | Promise<HtmlEscapedString> | string

export const panelText = messages({
  ja: {
    results: {
      applied: '操作を反映しました。',
      unchanged: 'すでにその状態です。',
      conflict:
        '画面を開いた後に公開状態が変わったため、反映しませんでした。現在の状態を確認して選び直してください。',
      not_paused: '停止中ではないため、再開しませんでした。',
      not_publishable:
        'この版は公開できません。このデッキの受領完了の版だけを選べます。',
      invalid: '操作の内容が正しくありません。',
    },
    modes: {
      manual: '手動公開（CI は下書きだけを作る）',
      repository: 'リポジトリ設定に従う（CI の published を反映する）',
    },
    version: (commit: Markup, deployment: Markup) =>
      html`${commit}（deployment ${deployment}）`,
    versionLabel: (commit: string, deployment: string) =>
      `${commit}（deployment ${deployment}）`,
    draft: '下書きのみ（一般公開していません）',
    public: (version: Markup) => html`一般公開中: ${version}`,
    pausedResumes: (version: Markup) =>
      html`公開停止中（再開すると ${version}を一般公開します）`,
    pausedDraft: '公開停止中（再開しても下書きのままです）',
    pauseNotePublic:
      '停止すると匿名の読者は開けなくなり、作者限定の閲覧も開き直しが必要になります。CI からも再開まで公開されません。',
    pauseNote:
      '停止すると作者限定の閲覧も開き直しが必要になり、再開するまで CI からも公開されません。',
    section: '公開状態',
    noDelivery:
      '配信ドメインが未設定のため、作者限定で開くことも、一般公開した版を読者が開くこともまだできません。公開状態の切り替えだけを記録します。',
    shareUrl: '共有 URL',
    copy: 'リンクをコピー',
    copied: 'コピーしました',
    open: '開く',
    mode: '公開モード',
    resume: '公開を再開する',
    pause: '公開を停止する',
    switchMode: {
      manual: '手動公開（CI は下書きだけを作る）に切り替える',
      repository:
        'リポジトリ設定に従う（CI の published を反映する）に切り替える',
    },
    toRepositoryNote:
      'CI の published: false は公開中の版も取り下げます。更新を下書きに置くだけなら手動公開のままにしてください。',
    toManualNote:
      '手動公開では CI は下書きだけを作り、公開する版は作者が選びます。',
    resumePublish: '停止を解除して、この版を一般公開します。',
    rollBack: (commit: string) =>
      `公開中の ${commit} より古い版に差し戻します。`,
    update: (commit: string) => `公開中の ${commit} をこの版に更新します。`,
    replaced: (change: string) =>
      `${change}公開中の版は置き換わり、その URL では開けなくなります。発表中なら発表後に操作してください。`,
    openLabel: (version: string) => `${version} を作者限定で新しい tab に開く`,
    openAsAuthor: '作者限定で開く',
    isPublic: '一般公開中',
    resumeTarget: '再開すると公開',
    publishLabel: (version: string) => `${version} を一般公開する`,
    publish: 'この版を一般公開する',
  },
  en: {
    results: {
      applied: 'Your change was applied.',
      unchanged: 'It is already in that state.',
      conflict:
        'Nothing was changed: the publication changed after you opened this page. Check the current state and choose again.',
      not_paused: 'Nothing was resumed: publishing is not paused.',
      not_publishable:
        'This version cannot be published. Only received versions of this deck can be chosen.',
      invalid: 'The request was not valid.',
    },
    modes: {
      manual: 'Manual publishing (CI only creates drafts)',
      repository: 'Follow the repository (CI applies its published setting)',
    },
    version: (commit: Markup, deployment: Markup) =>
      html`${commit} (deployment ${deployment})`,
    versionLabel: (commit: string, deployment: string) =>
      `${commit} (deployment ${deployment})`,
    draft: 'Drafts only (nothing is public)',
    public: (version: Markup) => html`Public: ${version}`,
    pausedResumes: (version: Markup) =>
      html`Paused (resuming makes ${version} public)`,
    pausedDraft: 'Paused (resuming leaves the deck as drafts)',
    pauseNotePublic:
      'Pausing closes the deck to anonymous readers, and author-only views must be reopened. CI cannot publish it either until you resume.',
    pauseNote:
      'Pausing means author-only views must be reopened, and CI cannot publish until you resume.',
    section: 'Publication',
    noDelivery:
      'The content domain is not set up, so versions cannot be opened as the author and readers cannot open public versions yet. Only the publication state is recorded.',
    shareUrl: 'Share link',
    copy: 'Copy link',
    copied: 'Copied',
    open: 'Open',
    mode: 'Publishing mode',
    resume: 'Resume publishing',
    pause: 'Pause publishing',
    switchMode: {
      manual: 'Switch to manual publishing (CI only creates drafts)',
      repository:
        'Switch to following the repository (CI applies its published setting)',
    },
    toRepositoryNote:
      'With published: false, CI also takes down the public version. To only add drafts, keep manual publishing.',
    toManualNote:
      'With manual publishing, CI only creates drafts, and you choose the version to publish.',
    resumePublish: 'Resumes publishing with this version.',
    rollBack: (commit: string) =>
      `Rolls back from the public ${commit} to this older version.`,
    update: (commit: string) => `Updates the public ${commit} to this version.`,
    replaced: (change: string) =>
      `${change} The public version is replaced and no longer opens at its URL. If you are presenting, wait until you finish.`,
    openLabel: (version: string) =>
      `Open ${version} as the author in a new tab`,
    openAsAuthor: 'Open as author',
    isPublic: 'Public',
    resumeTarget: 'Public on resume',
    publishLabel: (version: string) => `Publish ${version}`,
    publish: 'Publish this version',
  },
})

type PanelText = (typeof panelText)[Lang]

/** The deployment the deck points to: public, or restored on resume. */
export function pointedId(deck: DeckPublication): string | null {
  const { publication } = deck
  if (publication.kind === 'public') return publication.deploymentId
  return publication.kind === 'paused' ? publication.resumeTo : null
}

const short = (commit: string) => commit.slice(0, 12)

function stateText(t: PanelText, view: PanelView) {
  const { publication } = view.state
  // A commit can be uploaded more than once, so the deployment ID names
  // the history row.
  const commit = view.pointed
    ? t.version(
        html`<code>${short(view.pointed.commit)}</code>`,
        html`<code>${view.pointed.deploymentId}</code>`,
      )
    : ''
  switch (publication.kind) {
    case 'draft':
      return t.draft
    case 'public':
      return t.public(commit)
    case 'paused':
      return publication.resumeTo ? t.pausedResumes(commit) : t.pausedDraft
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
export function publicationPanel(deckId: string, view: PanelView, lang: Lang) {
  const t = panelText[lang]
  const deck = view.state
  const paused = deck.publication.kind === 'paused'
  const otherMode = deck.mode === 'manual' ? 'repository' : 'manual'
  const pauseNote =
    deck.publication.kind === 'public' ? t.pauseNotePublic : t.pauseNote
  return html`<section aria-label="${t.section}">
    ${view.result ? html`<p role="status">${t.results[view.result]}</p>` : ''}
    ${view.delivery ? '' : html`<p role="note">${t.noDelivery}</p>`}
    <p>${stateText(t, view)}</p>
    ${
      view.shareUrl
        ? html`<p>
            <label for="share-url">${t.shareUrl}</label>
            <input
              id="share-url"
              readonly
              style="width: 24em; max-width: 100%; box-sizing: border-box"
              value="${view.shareUrl}"
            />
            <button
              type="button"
              data-copy="share-url"
              data-copied="${t.copied}"
            >
              ${t.copy}
            </button>
            <a href="${view.shareUrl}">${t.open}</a>
          </p>`
        : ''
    }
    <p>${t.mode}: ${t.modes[deck.mode]}</p>
    <form method="post" action="${action(deckId)}">
      ${hiddenRevision(deck)}
      ${
        paused
          ? html`<input type="hidden" name="action" value="resume" />
              <button>${t.resume}</button>`
          : html`<input type="hidden" name="action" value="pause" />
              <button aria-describedby="pause-note">${t.pause}</button>
              <small id="pause-note">${pauseNote}</small>`
      }
    </form>
    <form method="post" action="${action(deckId)}">
      ${hiddenRevision(deck)}
      <input type="hidden" name="action" value="set_mode" />
      <input type="hidden" name="mode" value="${otherMode}" />
      <button aria-describedby="mode-note">${t.switchMode[otherMode]}</button>
      <small id="mode-note"
        >${
          otherMode === 'repository' ? t.toRepositoryNote : t.toManualNote
        }</small
      >
    </form>
  </section>`
}

/** What publishing this version does to the current publication. */
function publishNote(t: PanelText, view: PanelView, entry: HistoryEntry) {
  const { publication } = view.state
  const pointed = view.pointed
  if (publication.kind === 'paused') return t.resumePublish
  if (publication.kind !== 'public' || !pointed) return null
  const commit = short(pointed.commit)
  return t.replaced(
    entry.createdAt < pointed.createdAt ? t.rollBack(commit) : t.update(commit),
  )
}

/** Owner-only view and publish actions for one ready deployment. */
export function deploymentActions(
  deckId: string,
  view: PanelView,
  entry: HistoryEntry,
  lang: Lang,
) {
  if (entry.state !== 'ready') return ''
  const t = panelText[lang]
  // Versions of one commit differ only by deployment ID.
  const version = t.versionLabel(short(entry.commit), entry.deploymentId)
  const open = view.delivery
    ? html`<form
        method="post"
        action="/decks/${deckId}/deployments/${entry.deploymentId}/preview"
        target="_blank"
      >
        <button aria-label="${t.openLabel(version)}">${t.openAsAuthor}</button>
      </form>`
    : ''
  const { publication } = view.state
  if (
    publication.kind === 'public' &&
    publication.deploymentId === entry.deploymentId
  )
    return html`<strong>${t.isPublic}</strong>${open}`
  const resumes =
    publication.kind === 'paused' && publication.resumeTo === entry.deploymentId
  const note = publishNote(t, view, entry)
  const noteId = `publish-note-${entry.deploymentId}`
  const resumeId = `resume-target-${entry.deploymentId}`
  const described = [resumes ? resumeId : null, note ? noteId : null]
    .filter(Boolean)
    .join(' ')
  return html`${resumes ? html`<strong id="${resumeId}">${t.resumeTarget}</strong>` : ''}${open}
    <form method="post" action="${action(deckId)}">
      ${hiddenRevision(view.state)}
      <input type="hidden" name="action" value="publish" />
      <input type="hidden" name="deploymentId" value="${entry.deploymentId}" />
      <button
        aria-label="${t.publishLabel(version)}"
        ${described ? html`aria-describedby="${described}"` : ''}
      >
        ${t.publish}
      </button>
      ${note ? html`<small id="${noteId}">${note}</small>` : ''}
    </form>`
}
