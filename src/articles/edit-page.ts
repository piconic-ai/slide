import { html, raw } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { dayFormats } from '../share/dates'
import { messages, type Lang } from '../site/i18n'
import { stateOf, type ArticleState } from './article'
import { MAX_ARTICLE_CHARS, type PageRef } from './markdown'
import type { StoredArticle } from './store'

type Markup = HtmlEscapedString | Promise<HtmlEscapedString>

const text = messages({
  ja: {
    title: '記事の編集',
    back: (name: string) => `‹ 『${name}』の管理`,
    heading: '記事',
    draft: '下書き',
    published: '公開中',
    pending: '未反映の変更あり',
    body: '本文(Markdown)',
    howTo: '書き方',
    preview: 'プレビュー',
    publish: '公開する',
    update: '公開を更新',
    discard: '変更を破棄',
    unpublish: '公開を取り下げる',
    published_: '公開しました。',
    updated: '公開を更新しました。',
    discarded: '変更を破棄しました。公開中の本文に戻りました。',
    unpublished: '公開を取り下げました。記事は下書きに戻りました。',
    stale:
      '別のタブで更新されています。再読み込みしてください。入力した本文はこの画面に残っています。',
    tooLong: (shown: string) =>
      `本文は ${shown} 文字までです。保存していません。短くしてください。`,
    empty: '本文が空です。公開するには、本文を書いてください。',
    missing: (url: string, last: number) =>
      `${url} のページは、いまの版にありません(${last} ページまで)。読者には、ページの画像の代わりにふつうのリンクが出ます。`,
    length: (count: string, max: string) => `${count} / ${max} 文字`,
    lastSaved: (day: string) => `最後に保存した日: ${day}`,
    saving: '保存中…',
    savedAt: '保存しました({time})',
    failed: '保存できませんでした。もう一度試します',
    conflict: '別のタブで更新されています。再読み込みしてください',
    tooLongLive: '本文が長すぎるため、保存できません',
  },
  en: {
    title: 'Edit the article',
    back: (name: string) => `‹ Manage “${name}”`,
    heading: 'Article',
    draft: 'Draft',
    published: 'Published',
    pending: 'Changes not shown yet',
    body: 'Text (Markdown)',
    howTo: 'How to write',
    preview: 'Preview',
    publish: 'Publish',
    update: 'Update publication',
    discard: 'Discard changes',
    unpublish: 'Unpublish',
    published_: 'Published.',
    updated: 'The publication is updated.',
    discarded: 'Changes discarded. The published text is back.',
    unpublished: 'Unpublished. The article is a draft again.',
    stale:
      'It was updated in another tab. Reload this page. The text you typed is still here.',
    tooLong: (shown: string) =>
      `The text can have at most ${shown} characters. It was not saved. Shorten it.`,
    empty: 'The text is empty. Write something to publish it.',
    missing: (url: string, last: number) =>
      `The page at ${url} is not in the current version (it has ${last} pages). Readers see a plain link instead of the page image.`,
    length: (count: string, max: string) => `${count} / ${max} characters`,
    lastSaved: (day: string) => `Last saved: ${day}`,
    saving: 'Saving…',
    savedAt: 'Saved ({time})',
    failed: 'Could not save. Trying again',
    conflict: 'It was updated in another tab. Reload this page',
    tooLongLive: 'The text is too long to save',
  },
})

/**
 * The box for the text. Its first line break is not part of the text, so one
 * is put in front: a text that starts with a blank line keeps it. Built as a
 * plain string so that no formatter puts another line break there.
 */
const articleInput = (body: string) =>
  raw(
    '<textarea class="article-input" id="article-body" name="body" rows="24" ' +
      'spellcheck="false">\n' +
      String(html`${body}`) +
      '</textarea>',
  )

/** What the editing page tells the author about what they just did. */
export type EditNotice =
  | 'published'
  | 'updated'
  | 'discarded'
  | 'unpublished'
  | 'too_long'
  | 'empty'
  | 'stale'

/** What the editing page shows. */
export type EditView = Readonly<{
  slug: string
  /** The title of the slides, or their URL name. */
  deckName: string
  /** What is kept; null before the first save. */
  article: StoredArticle | null
  /** The text in the box: what the author edits, or what they just sent. */
  body: string
  /** The revision the page loads; a save names it, so a stale one is found. */
  revision: number | null
  /** The article as the viewer draws it, for beside the box; null when too long. */
  pane: Markup | null
  notice: EditNotice | null
  /** The pages of the article's own slides that the version does not have. */
  missing: readonly PageRef[]
  /** How many pages the version has; set only when `missing` is not empty. */
  pageCount: number | null
}>

/** The page title of the editing page, for renderPage. */
export const editTitle = (lang: Lang) => text[lang].title

const numbers = new Intl.NumberFormat('en-US')

/** The state tags: draft, published, and published with an edit not shown yet. */
export const stateChips = (state: ArticleState, lang: Lang) =>
  state === 'none'
    ? ''
    : html`<span
          class="status-chip ${state === 'draft' ? 'status-draft' : 'status-public'}"
          >${state === 'draft' ? text[lang].draft : text[lang].published}</span
        >
        <span
          class="status-chip status-paused"
          data-pending-chip
          ${state === 'pending' ? '' : html`hidden`}
          >${text[lang].pending}</span
        >`

function notice(view: EditView, lang: Lang) {
  const t = text[lang]
  if (view.notice === null) return ''
  const words = {
    published: t.published_,
    updated: t.updated,
    discarded: t.discarded,
    unpublished: t.unpublished,
    too_long: t.tooLong(numbers.format(MAX_ARTICLE_CHARS)),
    empty: t.empty,
    stale: t.stale,
  }[view.notice]
  const bad =
    view.notice === 'too_long' ||
    view.notice === 'empty' ||
    view.notice === 'stale'
  return html`<p
    class="${bad ? 'notice-danger' : 'notice-success'}"
    role="${bad ? 'alert' : 'status'}"
  >
    ${words}
  </p>`
}

/** One button of the form; the text of the box and the revision go with it. */
const button = (
  value: string,
  label: string,
  kind: 'primary' | 'secondary',
  extra: Markup | string = '',
) =>
  html`<button
    class="button-${kind}"
    type="submit"
    name="action"
    value="${value}"
    ${extra}
  >
    ${label}
  </button>`

/** The buttons: for a draft, preview and publish; for a publication, more. */
function actions(state: ArticleState, lang: Lang) {
  const t = text[lang]
  const published = state === 'published' || state === 'pending'
  const idle = state === 'pending' ? '' : html`disabled`
  return html`<div class="article-actions">
    ${button('preview', t.preview, 'secondary')}
    ${
      published
        ? html`${button('update', t.update, 'primary', html`data-needs-pending ${idle}`)}
          ${button('discard', t.discard, 'secondary', html`data-needs-pending ${idle}`)}
          ${button('unpublish', t.unpublish, 'secondary')}`
        : button('publish', t.publish, 'primary')
    }
  </div>`
}

/**
 * The editing page of one slide's article. One box for the Markdown, always
 * there, kept by the page's script (`/article-edit.js`) as the author types:
 * a draft in its own text, a published article in an edit of its own that
 * readers do not see until the publication is updated. On a wide screen the
 * article as the viewer draws it stands beside the box; the script asks the
 * server for it and puts in only the HTML the server made. The buttons all
 * send the form, so the text is never lost: not on the preview, not when it
 * was too long.
 */
export function editBody(view: EditView, lang: Lang) {
  const t = text[lang]
  const state = stateOf(view.article)
  const unsaved =
    view.body !== (view.article?.draftBody ?? view.article?.body ?? '')
  return html`<div
    class="article-edit"
    data-article-edit
    data-deck="${view.slug}"
    data-lang="${lang}"
    data-text-saving="${t.saving}"
    data-text-saved="${t.savedAt}"
    data-text-failed="${t.failed}"
    data-text-conflict="${t.conflict}"
    data-text-too-long="${t.tooLongLive}"
  >
    <p>
      <a class="back-link" href="/slides/${view.slug}"
        >${t.back(view.deckName)}</a
      >
    </p>
    <div class="article-edit-head">
      <h1>${t.heading}</h1>
      <span data-state-chips>${stateChips(state, lang)}</span>
    </div>
    ${notice(view, lang)}
    <div class="article-split">
      <form
        method="post"
        action="/slides/${view.slug}/article"
        data-unsaved="${unsaved ? 'true' : 'false'}"
      >
        <input
          type="hidden"
          name="revision"
          value="${view.revision === null ? '' : String(view.revision)}"
        />
        <div>
          <label for="article-body">${t.body}</label>
          ${articleInput(view.body)}
          <p class="field-note" data-autosave-status role="status"></p>
        </div>
        ${
          view.missing.length > 0 && view.pageCount !== null
            ? view.missing.map(
                (ref) =>
                  html`<p class="notice-warning" role="status">
                    ${t.missing(`/@${ref.handle}/${ref.slug}/${ref.page}`, view.pageCount ?? 0)}
                  </p>`,
              )
            : ''
        }
        ${actions(state, lang)}
        <p class="article-howto">
          <a href="/help#article">${t.howTo}</a>
        </p>
      </form>
      <aside class="article-pane" data-article-pane aria-label="${t.preview}">
        ${view.pane ?? ''}
      </aside>
    </div>
    <script src="/article-edit.js" defer></script>
    <style>
      /* The box is the page: wider than the other pages' column. */
      main:has(.article-edit) {
        max-width: 1152px;
      }
      .page .article-edit form {
        max-width: none;
      }
      .article-edit-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
      }
      .article-edit-head h1 {
        margin: 0;
      }
      .article-edit-head .status-chip {
        margin: 0 8px 0 0;
      }
      .article-edit-head [hidden] {
        display: none;
      }
      .article-input {
        max-width: none;
        height: clamp(620px, 62dvh, 900px);
        min-height: 320px;
        font-family: var(--font-mono);
        font-size: 14px;
        line-height: 1.7;
        resize: vertical;
      }
      .article-pane {
        display: none;
      }
      /* Wide enough for both: the box on the left, the article as readers
         read it on the right, kept in view while the box scrolls. */
      @media (min-width: 1100px) {
        main:has(.article-edit) {
          max-width: 1480px;
        }
        .article-split {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 24px;
          align-items: start;
        }
        .article-pane {
          display: block;
          position: sticky;
          top: 16px;
          max-height: calc(100dvh - 32px);
          overflow: auto;
          padding: 0 20px 16px;
          border: 1px solid var(--border);
          border-radius: var(--radius);
        }
        .article-pane .viewer-article {
          margin-top: 16px;
        }
      }
      .article-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin: 16px 0;
      }
      .article-actions button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .article-howto {
        margin: 0;
      }
      .article-howto a {
        display: inline-flex;
        align-items: center;
        min-height: 44px;
        font-size: 13px;
      }
      .article-edit .notice-warning {
        max-width: 40em;
      }
    </style>
  </div>`
}

/**
 * The frame on the page of one slide: whether it has an article, in what
 * state, when it was saved and how long it is, and the way to the editing
 * page.
 */
export function articleFrameBody(
  slug: string,
  article: StoredArticle | null,
  length: number,
  lang: Lang,
) {
  const t = text[lang]
  return html`<section class="panel" data-deck-frame="article">
    <h2>${t.heading}</h2>
    ${stateChips(stateOf(article), lang)}
    <p>${frameText[lang].note}</p>
    ${
      article
        ? html`<p class="field-note">
            ${t.lastSaved(dayFormats[lang].format(new Date(article.updatedAt * 1000)))}
            ·
            ${t.length(numbers.format(length), numbers.format(MAX_ARTICLE_CHARS))}
          </p>`
        : ''
    }
    <p>
      <a class="button-secondary" href="/slides/${slug}/article"
        >${article ? frameText[lang].edit : frameText[lang].write}</a
      >
    </p>
  </section>`
}

const frameText = messages({
  ja: {
    note: 'スライドの下に載る、発表の書き起こし。スライドが一般公開中で、記事も公開したときだけ読者に見える。',
    edit: '記事を編集する',
    write: '記事を書く',
  },
  en: {
    note: 'A transcript of the talk, shown under the slides. Readers see it only while the slides are public and the article is published.',
    edit: 'Edit the article',
    write: 'Write the article',
  },
})
