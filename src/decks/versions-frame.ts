import { html } from 'hono/html'
import {
  hiddenRevision,
  previewForm,
  publicationAction,
  type PanelView,
} from '../publication/panel'
import {
  versionRows,
  type VersionRow,
  type VersionRowKind,
} from '../publication/version-rows'
import { dayFormats } from '../share/dates'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    kinds: {
      visible: '読者に見えている版',
      unpublished: 'まだ公開していません',
      stopped: '公開を止めています',
      newer: 'まだ公開していない新しい版',
    } satisfies Record<VersionRowKind, string>,
    received: (day: string) => `${day}に受け取り`,
    view: '見る',
    publish: 'この版を公開する',
    again: 'もう一度公開する',
  },
  en: {
    kinds: {
      visible: 'Version readers see',
      unpublished: 'Not published yet',
      stopped: 'Publishing is stopped',
      newer: 'New version, not published yet',
    } satisfies Record<VersionRowKind, string>,
    received: (day: string) => `Received on ${day}`,
    view: 'View',
    publish: 'Publish this version',
    again: 'Publish again',
  },
})

/** The form that publishes a row's version, or publishes it again. */
function publishForm(
  deck: string,
  view: PanelView,
  row: VersionRow,
  label: string,
) {
  const resumes = row.action === 'resume'
  return html`<form method="post" action="${publicationAction(deck)}">
    ${hiddenRevision(view.state)}
    <input
      type="hidden"
      name="action"
      value="${resumes ? 'resume' : 'publish'}"
    />
    ${
      resumes
        ? ''
        : html`<input
            type="hidden"
            name="deploymentId"
            value="${row.version.deploymentId}"
          />`
    }
    <button class="button-primary">${label}</button>
  </form>`
}

function versionItem(
  deck: string,
  view: PanelView,
  row: VersionRow,
  lang: Lang,
) {
  const t = text[lang]
  const at = new Date(row.version.readyAt * 1000)
  const label = row.kind === 'stopped' ? t.again : t.publish
  return html`<li class="version-row" data-version-row="${row.kind}">
    <div class="version-row-text">
      <span class="version-row-kind">${t.kinds[row.kind]}</span>
      <span class="version-row-date"
        ><time datetime="${at.toISOString()}"
          >${t.received(dayFormats[lang].format(at))}</time
        ></span
      >
    </div>
    ${view.delivery ? previewForm(deck, row.version.deploymentId, t.view) : ''}
    ${row.action === 'none' ? '' : publishForm(deck, view, row, label)}
  </li>`
}

/**
 * The versions under the drop zone: the one readers see, and the new one
 * they do not see yet. Never more than two rows, and none while nothing was
 * received.
 */
export function versionsList(deck: string, view: PanelView, lang: Lang) {
  // An operator's takedown refuses every action here, so no row is offered.
  if (view.takedown) return ''
  const rows = versionRows(view.state.publication, view.pointed, view.latest)
  return rows.length
    ? html`<ul class="version-rows">
        ${rows.map((row) => versionItem(deck, view, row, lang))}
      </ul>`
    : ''
}
