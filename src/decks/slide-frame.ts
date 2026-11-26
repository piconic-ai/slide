import { html } from 'hono/html'
import {
  hiddenRevision,
  panelText,
  publicationAction,
  publicationNotices,
  viewerLink,
  type PanelView,
} from '../publication/panel'
import {
  versionRows,
  type VersionRow,
  type VersionRowKind,
} from '../publication/version-rows'
import { dayFormats } from '../share/dates'
import type { Handle } from '../share/handle'
import { ownerViewerPath } from '../share/path'
import { dropZoneBody } from '../site/drop-zone-body'
import { messages, type Lang } from '../site/i18n'
import type { DeckSlug } from './deck-id'

const text = messages({
  ja: {
    heading: 'スライド',
    kinds: {
      visible: '読者に見えている版',
      unpublished: 'まだ公開していない版',
      stopped: '止める前に見えていた版',
      newer: 'まだ公開していない新しい版',
    } satisfies Record<VersionRowKind, string>,
    buttons: {
      visible: '公開を止める',
      unpublished: '公開する',
      stopped: 'もう一度公開する',
      newer: 'この版を公開する',
    } satisfies Record<VersionRowKind, string>,
    received: (day: string) => `${day}に受け取り`,
    view: '見る',
    dropTitle: '新しい版をドロップ',
    dropNote:
      'HTML、zip に対応。共有 URL は変わりません。記事と関連リンクも残ります。',
    firstDropTitle: 'スライドをドロップ',
    firstDropNote: '置くと、ここから公開できます。HTML、zip に対応。',
  },
  en: {
    heading: 'Slides',
    kinds: {
      visible: 'Version readers see',
      unpublished: 'Version not published yet',
      stopped: 'Version readers saw before you stopped',
      newer: 'New version, not published yet',
    } satisfies Record<VersionRowKind, string>,
    buttons: {
      visible: 'Stop publishing',
      unpublished: 'Publish',
      stopped: 'Publish again',
      newer: 'Publish this version',
    } satisfies Record<VersionRowKind, string>,
    received: (day: string) => `Received on ${day}`,
    view: 'View',
    dropTitle: 'Drop a new version',
    dropNote:
      'HTML and zip work. The share link stays the same. The article and related links stay too.',
    firstDropTitle: 'Drop your slides',
    firstDropNote: 'Then you can publish them here. HTML and zip work.',
  },
})

/**
 * The form of a row's one button. Stopping is the quiet choice; publishing
 * is primary, except a newer version's while the first row also publishes,
 * so that one primary button shows at a time.
 */
function rowForm(
  deck: string,
  view: PanelView,
  row: VersionRow,
  primary: boolean,
  label: string,
) {
  return html`<form method="post" action="${publicationAction(deck)}">
    ${hiddenRevision(view.state)}
    <input type="hidden" name="action" value="${row.action}" />
    ${
      row.action === 'publish'
        ? html`<input
            type="hidden"
            name="deploymentId"
            value="${row.version.deploymentId}"
          />`
        : ''
    }
    <button class="${primary ? 'button-primary' : 'button-secondary'}">
      ${label}
    </button>
  </form>`
}

/**
 * What "view" opens: the version in the author's viewer. The one readers see
 * opens as readers see it, at the plain address; any other version names
 * itself in the address. Nothing without a handle or a content origin.
 */
function viewControl(
  deck: DeckSlug,
  handle: Handle | null,
  view: PanelView,
  row: VersionRow,
  label: string,
) {
  if (handle === null || !view.delivery) return ''
  const version = row.kind === 'visible' ? null : row.version.deploymentId
  return viewerLink(ownerViewerPath(handle, deck, version), label)
}

function versionItem(
  deck: DeckSlug,
  handle: Handle | null,
  view: PanelView,
  rows: readonly VersionRow[],
  index: number,
  lang: Lang,
) {
  const t = text[lang]
  const row = rows[index] as VersionRow
  const kind = view.state.publication.kind
  const at = new Date(row.version.readyAt * 1000)
  const primary =
    row.action === 'pause' ? false : index === 0 || rows[0]?.action === 'pause'
  return html`<li class="version-row" data-version-row="${row.kind}">
    <div class="version-row-text">
      <span class="version-row-name"
        ><span class="version-row-kind">${t.kinds[row.kind]}</span> ${
          index === 0
            ? html`<span class="status-chip status-${kind}"
                >${panelText[lang].states[kind]}</span
              >`
            : ''
        }</span
      >
      <span class="version-row-date"
        ><time datetime="${at.toISOString()}"
          >${t.received(dayFormats[lang].format(at))}</time
        ></span
      >
    </div>
    ${viewControl(deck, handle, view, row, t.view)}
    ${rowForm(deck, view, row, primary, t.buttons[row.kind])}
  </li>`
}

/**
 * Where the slides are dropped: low under the rows, and large while no
 * version was received yet. The button starts disabled and /drop.js enables
 * it; the script sends the file as a new version of this slide and opens the
 * page again. What readers see does not change until the author publishes
 * the new version from its row.
 */
function dropZone(slug: string, first: boolean, lang: Lang) {
  const t = text[lang]
  const words = first
    ? { title: t.firstDropTitle, note: t.firstDropNote }
    : { title: t.dropTitle, note: t.dropNote }
  return html`<div
    class="drop-zone ${first ? 'drop-zone-first' : 'drop-zone-low'}"
    data-drop-zone="replace"
    data-deck="${slug}"
  >
    ${dropZoneBody(lang, words)}
  </div>`
}

/**
 * The slide frame of a slide's page, right under the title: what readers
 * see and what can change it, in one place. From the top:
 *
 * - the notices: the last outcome, the operator's takedown, no content origin;
 * - the versions, at most two rows. The first is the one publication points
 *   at, with the tag that says where publication stands and the one button
 *   that changes it; the second, a newer version with the button that
 *   publishes it. An operator's takedown refuses every action, so it shows
 *   neither rows nor tag;
 * - the drop zone, for a new version.
 *
 * Each version is published by one button only, on its own row.
 */
export function slideFrame(
  deck: DeckSlug,
  handle: Handle | null,
  view: PanelView,
  lang: Lang,
) {
  const rows = versionRows(view.state.publication, view.pointed, view.latest)
  const received = view.latest !== null || view.pointed !== null
  const shown = view.takedown ? [] : rows
  return html`<section
    class="panel"
    data-deck-frame="slide"
    aria-labelledby="slide-heading"
  >
    <h2 id="slide-heading">${text[lang].heading}</h2>
    ${publicationNotices(view, lang)}
    ${
      shown.length
        ? html`<ul class="version-rows">
            ${shown.map((_, index) =>
              versionItem(deck, handle, view, shown, index, lang),
            )}
          </ul>`
        : ''
    }
    ${dropZone(deck, !received, lang)}
  </section>`
}
