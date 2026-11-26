import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { messages, type Lang } from '../site/i18n'
import { pageShell } from '../site/shell'
import {
  articleHeading,
  articleId,
  isDraft,
  splitLinks,
  SUPPLEMENT_HEADING,
  SUPPLEMENT_ID,
  type Article,
  type ArticleText,
  type Clause,
  type HistoryEntry,
  type LegalText,
  type TextLink,
  type TransmissionText,
} from './document'
import { LEGAL_TEXT_PATHS } from './documents'

type Html = HtmlEscapedString | Promise<HtmlEscapedString>

/** The marks of a draft. The text is Japanese only (D-25), so these are too. */
export const DRAFT_SUFFIX = '(下書き)'
export const DRAFT_NOTICE =
  'この文面は下書きです。正式な内容は、施行日を入れて公開します。'

/** Shown above a text when the screen is in English (D-25). */
export const JAPANESE_ONLY_NOTICE = 'This page is available in Japanese only.'

/** Words of the frame around a text; the text itself is never translated. */
const frame = messages({
  ja: { backToPrivacy: 'プライバシーポリシーへ戻る' },
  en: { backToPrivacy: 'Back to the Privacy Policy' },
})

/** The title of a text, with the mark of a draft while it is one. */
export const pageTitle = (text: LegalText): string =>
  isDraft(text) ? `${text.title}${DRAFT_SUFFIX}` : text.title

const style = html`<style>
  /* The text is set in numbered lists as written: the browser numbers them. */
  .legal > p,
  .legal .legal-article > p {
    max-width: 40em;
  }
  .legal ol,
  .legal ul {
    max-width: 40em;
    padding-inline-start: 1.75em;
  }
  .legal-note {
    box-sizing: border-box;
    max-width: 40em;
    margin: 0 0 16px;
    padding: 12px 16px;
    border: 1px solid var(--input);
    border-radius: var(--radius);
  }
  /* The name of a policy stays on one line when the table is a table. */
  @media (min-width: 600px) {
    .legal .legal-table td:last-child {
      white-space: nowrap;
    }
  }
  .legal .legal-table a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
</style>`

const sentence = (text: string, links: readonly TextLink[]): Html[] =>
  splitLinks(text, links).map((segment) =>
    segment.kind === 'link'
      ? html`<a href="${segment.href}">${segment.text}</a>`
      : html`${segment.text}`,
  )

const itemList = (items: readonly string[], links: readonly TextLink[]) =>
  items.length === 0
    ? ''
    : html`<ol>
        ${items.map((item) => html`<li>${sentence(item, links)}</li>`)}
      </ol>`

const clause = (value: Clause, links: readonly TextLink[]) =>
  html`<li>${sentence(value.text, links)}${itemList(value.items, links)}</li>`

const article = (value: Article, links: readonly TextLink[]) => html`
  <section class="legal-article" aria-labelledby="${articleId(value)}">
    <h2 id="${articleId(value)}">${articleHeading(value)}</h2>
    ${
      value.body.kind === 'clauses'
        ? html`<ol>
            ${value.body.clauses.map((item) => clause(item, links))}
          </ol>`
        : html`${value.body.paragraphs.map(
            (paragraph) => html`<p>${sentence(paragraph, links)}</p>`,
          )}${itemList(value.body.items, links)}`
    }
  </section>
`

const supplement = (history: readonly HistoryEntry[]) => html`
  <section class="legal-article" aria-labelledby="${SUPPLEMENT_ID}">
    <h2 id="${SUPPLEMENT_ID}">${SUPPLEMENT_HEADING}</h2>
    <ul>
      ${history.map((entry) => html`<li>${entry.date}: ${entry.summary}</li>`)}
    </ul>
  </section>
`

const articlesBody = (text: ArticleText) => html`
  ${text.preamble.map(
    (paragraph) => html`<p>${sentence(paragraph, text.links)}</p>`,
  )}
  ${text.articles.map((item) => article(item, text.links))}
  ${supplement(text.history)}
`

const transmissionBody = (text: TransmissionText, lang: Lang) => html`
  <p>${text.description}</p>
  <table class="data-table legal-table">
    <thead>
      <tr>
        ${text.columns.map((column) => html`<th scope="col">${column}</th>`)}
      </tr>
    </thead>
    <tbody>
      ${text.rows.map(
        (row) =>
          html`<tr>
            <td>
              <span class="cell-label">${text.columns[0]}</span
              >${row.destination}
            </td>
            <td>
              <span class="cell-label">${text.columns[1]}</span
              >${row.information}
            </td>
            <td>
              <span class="cell-label">${text.columns[2]}</span>${row.purpose}
            </td>
            <td>
              <span class="cell-label">${text.columns[3]}</span
              ><a href="${row.policy.url}" rel="noopener noreferrer"
                >${row.policy.label}</a
              >
            </td>
          </tr>`,
      )}
    </tbody>
  </table>
  <p lang="${lang}">
    <a class="back-link" href="${LEGAL_TEXT_PATHS.privacy}"
      >${frame[lang].backToPrivacy}</a
    >
  </p>
  ${supplement(text.history)}
`

/**
 * One legal text as a page. Everything depends on the text itself: while
 * its first date is not a date, the page says so and is not listed (the
 * route and `indexableLegalPaths` read the same `isDraft`).
 */
export const legalTextPage = (text: LegalText, lang: Lang, url: URL) => {
  const draft = isDraft(text)
  const title = pageTitle(text)
  return pageShell({
    lang,
    title,
    titleLang: 'ja',
    url,
    width: 'reading',
    style,
    body: html`<div class="legal" lang="ja">
      <h1>${title}</h1>
      ${
        draft ? html`<p class="legal-note" role="note">${DRAFT_NOTICE}</p>` : ''
      }
      ${
        lang === 'en'
          ? html`<p class="legal-note" role="note" lang="en">
              ${JAPANESE_ONLY_NOTICE}
            </p>`
          : ''
      }
      ${
        text.form === 'articles'
          ? articlesBody(text)
          : transmissionBody(text, lang)
      }
    </div>`,
  })
}
