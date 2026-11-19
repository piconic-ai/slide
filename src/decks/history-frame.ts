import { html } from 'hono/html'
import { deploymentActions, type PanelView } from '../publication/panel'
import { dayFormats } from '../share/dates'
import { messages, type Lang } from '../site/i18n'
import { reasonLabel, stateLabel, type HistoryEntry } from './history'

const text = messages({
  ja: {
    heading: '版の履歴',
    noteDelivery:
      '受領完了の版は、一般公開するまで作者だけが開けます。作者限定で開くと別の tab で表示し、この画面は残ります。',
    note: '受領完了の版は、一般公開するまで作者だけのものです。',
    missing: (count: number) => `未受領 ${count} 件`,
    more: (count: number) => `ほか ${count} 件`,
    columns: {
      state: '状態',
      files: 'ファイル',
      started: '開始',
      publish: '公開',
    },
    none: 'まだ受領した版はありません。',
    older: 'さらに古い版',
  },
  en: {
    heading: 'Versions',
    noteDelivery:
      'A received version is open only to you until you publish it. Opening it as the author shows it in another tab and keeps this page.',
    note: 'A received version stays yours alone until you publish it.',
    missing: (count: number) => `${count} not received`,
    more: (count: number) => `${count} more`,
    columns: {
      state: 'State',
      files: 'Files',
      started: 'Started',
      publish: 'Publish',
    },
    none: 'No versions received yet.',
    older: 'Older versions',
  },
})

/** The day a version began, with the moment itself for machines. */
const started = (seconds: number, lang: Lang) => {
  const at = new Date(seconds * 1000)
  return html`<time datetime="${at.toISOString()}"
    >${dayFormats[lang].format(at)}</time
  >`
}

function filesCell(entry: HistoryEntry, lang: Lang) {
  const t = text[lang]
  const { files } = entry
  const missing = files.missing.length
    ? html`<details>
        <summary>
          ${t.missing(files.missing.length + files.missingNotShown)}
        </summary>
        <ul>
          ${files.missing.map((path) => html`<li><code>${path}</code></li>`)}
        </ul>
        ${files.missingNotShown ? html`<p>${t.more(files.missingNotShown)}</p>` : ''}
      </details>`
    : ''
  return html`${files.received} / ${files.total}${missing}`
}

/**
 * The versions of one of the author's slides, newest first, each with the
 * ways to open it as the author and to publish it. What a version came from
 * is still shown as its commit and ref; the drop feature replaces that with
 * where the version was sent from.
 */
export function historyFrame(
  deck: string,
  entries: readonly HistoryEntry[],
  olderCursor: string | null,
  publication: PanelView,
  lang: Lang,
) {
  const t = text[lang]
  const rows = entries.map(
    (entry) =>
      html`<tr>
        <td>
          <span class="cell-label">commit / ref</span>
          <code>${entry.commit.slice(0, 12)}</code><br /><code
            >${entry.ref}</code
          >
        </td>
        <td>
          <span class="cell-label">${t.columns.state}</span>
          ${stateLabel(entry.state, lang)}
          ${
            entry.failureReason
              ? html`<div class="reason notice-danger">
                  ${reasonLabel(entry.failureReason, lang)}
                </div>`
              : ''
          }
        </td>
        <td>
          <span class="cell-label">${t.columns.files}</span
          >${filesCell(entry, lang)}
        </td>
        <td>
          <span class="cell-label">${t.columns.started}</span
          >${started(entry.createdAt, lang)}
        </td>
        <td>
          <span class="cell-label">deployment</span
          ><code>${entry.deploymentId}</code>
        </td>
        <td>
          <span class="cell-label">${t.columns.publish}</span
          >${deploymentActions(deck, publication, entry, lang)}
        </td>
      </tr>`,
  )
  return html`<section data-deck-frame="history">
    <h2>${t.heading}</h2>
    <p>${publication.delivery ? t.noteDelivery : t.note}</p>
    <table class="data-table stacked-table">
      <tr>
        <th>commit / ref</th>
        <th>${t.columns.state}</th>
        <th>${t.columns.files}</th>
        <th>${t.columns.started}</th>
        <th>deployment</th>
        <th>${t.columns.publish}</th>
      </tr>
      ${
        rows.length
          ? rows
          : html`<tr>
              <td colspan="6">${t.none}</td>
            </tr>`
      }
    </table>
    ${
      olderCursor
        ? html`<p>
            <a
              class="back-link"
              href="/slides/${deck}?before=${encodeURIComponent(olderCursor)}"
              >${t.older}</a
            >
          </p>`
        : ''
    }
  </section>`
}
