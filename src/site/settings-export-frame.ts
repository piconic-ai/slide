import { html } from 'hono/html'
import { downloadLinks, type DownloadLink } from './download-links'
import { messages, type Lang } from './i18n'
import { panelText } from '../publication/panel'
import type { ExportSlideRow } from '../exports/list-view'
import { exportPageHref } from '../exports/list-view'

const text = messages({
  ja: {
    note: 'あなたのスライド(限定公開、非公開、運営が非表示にしたものを含みます)と、アカウントの情報を書き出せます。',
    account: 'アカウント',
    slides: 'スライド',
    none: 'まだスライドがありません。',
    hidden: '運営が非表示にしています',
    pages: '書き出しのスライドのページ',
    previous: '前のページ',
    next: '次のページ',
    page: (page: number, last: number) => `${page} / ${last} ページ`,
    agent: 'AI エージェントで書き出す方法',
  },
  en: {
    note: 'Take out all your slides, including unlisted, private and hidden ones, and your account information.',
    account: 'Account',
    slides: 'Slides',
    none: 'You have no slides yet.',
    hidden: 'Hidden by the operator',
    pages: 'Pages of slides to export',
    previous: 'Previous page',
    next: 'Next page',
    page: (page: number, last: number) => `Page ${page} of ${last}`,
    agent: 'Export with an AI agent',
  },
})

const headings = messages({
  ja: { heading: 'データを書き出す' },
  en: { heading: 'Export your data' },
})

/** Where "Export with an AI agent" leads: the help on AI agents. */
export const EXPORT_AGENT_HELP_PATH = '/help/agent'

/** What the settings page gives the export place. */
export type DataExportView = Readonly<{
  /** The account's information, and the picture when there is one. */
  account: readonly DownloadLink[]
  /** One page of the person's slides. */
  slides: readonly ExportSlideRow[]
  page: number
  lastPage: number
}>

const stateLabel = (row: ExportSlideRow, lang: Lang) =>
  row.hiddenByOperator ? text[lang].hidden : panelText[lang].states[row.state]

const slideRow = (row: ExportSlideRow, lang: Lang) =>
  html`<li class="export-slide">
    <p class="export-slide-name">${row.name}</p>
    <p class="export-slide-state">${stateLabel(row, lang)}</p>
    ${downloadLinks(row.links)}
  </li>`

const pager = (view: DataExportView, lang: Lang, url: URL) => {
  if (view.lastPage <= 1) return ''
  const t = text[lang]
  return html`<nav class="export-pages" aria-label="${t.pages}">
    ${
      view.page > 1
        ? html`<a href="${exportPageHref(url, view.page - 1)}" rel="prev"
            >${t.previous}</a
          >`
        : ''
    }
    <span aria-current="page">${t.page(view.page, view.lastPage)}</span>
    ${
      view.page < view.lastPage
        ? html`<a href="${exportPageHref(url, view.page + 1)}" rel="next"
            >${t.next}</a
          >`
        : ''
    }
  </nav>`
}

/**
 * The place in settings for taking one's data out (02-PAGES 09). It sits in
 * the account part of the page, above leaving the service: what it holds, the
 * account's links, one row for each slide (not a table, so it reads the same
 * at 375px), and the way to export with an AI agent. With no view, settings
 * show nothing here.
 */
export const settingsExportFrame = (
  view: DataExportView | null,
  lang: Lang,
  url: URL,
) =>
  view === null
    ? ''
    : html`<section class="panel" id="export">
        <h2>${headings[lang].heading}</h2>
        <p>${text[lang].note}</p>
        <h3>${text[lang].account}</h3>
        ${downloadLinks(view.account)}
        <h3>${text[lang].slides}</h3>
        ${
          view.slides.length === 0
            ? html`<p class="field-note">${text[lang].none}</p>`
            : html`<ul class="export-slides" role="list">
                  ${view.slides.map((row) => slideRow(row, lang))}
                </ul>
                ${pager(view, lang, url)}`
        }
        <p>
          <a class="export-help" href="${EXPORT_AGENT_HELP_PATH}"
            >${text[lang].agent}</a
          >
        </p>
      </section>`
