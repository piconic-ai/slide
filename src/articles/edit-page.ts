import { html, raw } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { dayFormats } from '../share/dates'
import { messages, type Lang } from '../site/i18n'
import { MAX_ARTICLE_CHARS, type PageRef } from './markdown'
import type { ArticleStatus } from './article'
import type { StoredArticle } from './store'

type Markup = HtmlEscapedString | Promise<HtmlEscapedString>

const text = messages({
  ja: {
    title: '記事の編集',
    back: (name: string) => `‹ 『${name}』の管理`,
    heading: '記事',
    draft: '下書き',
    published: '公開中',
    tabs: '表示の切り替え',
    write: '書く',
    preview: 'プレビュー',
    body: '本文(Markdown)',
    note: 'ページ番号つきの共有 URL を 1 行で書くと、そのページの画像が入ります。自分のこのスライドなら、押すと上のスライドがそのページに移ります。ほかのスライドなら、押すとそのスライドのそのページを開き、引用として数えられます。文の中に書いた URL は、ふつうのリンクになります。HTML と script は使えません。',
    publishNote:
      '公開すると、スライドが一般公開中の間だけ、viewer のスライドの下に載ります。公開した後も、ここで直して保存すると、すぐ反映されます。AI エージェントは下書きまでしか置けません。',
    saveDraft: '下書きを保存',
    save: '保存する',
    publish: '公開する',
    unpublish: '公開を取り下げる',
    previewEmpty: '本文がありません。',
    saved: '保存しました。',
    published_: '公開しました。',
    unpublished: '公開を取り下げました。記事は下書きに戻りました。',
    tooLong: (shown: string) =>
      `本文は ${shown} 文字までです。保存していません。短くしてから、もう一度保存してください。`,
    empty: '本文が空です。公開するには、本文を書いてください。',
    missing: (url: string, last: number) =>
      `${url} のページは、いまの版にありません(${last} ページまで)。読者には、ページの画像の代わりにふつうのリンクが出ます。`,
    length: (count: string, max: string) => `${count} / ${max} 文字`,
    lastSaved: (day: string) => `最後に保存した日: ${day}`,
  },
  en: {
    title: 'Edit the article',
    back: (name: string) => `‹ Manage “${name}”`,
    heading: 'Article',
    draft: 'Draft',
    published: 'Published',
    tabs: 'Switch view',
    write: 'Write',
    preview: 'Preview',
    body: 'Text (Markdown)',
    note: 'A share URL with a page number, alone on a line, becomes an image of that page. For these slides, pressing it moves the slides above to that page. For other slides, pressing it opens that page of those slides and counts as a citation. A URL inside a sentence stays a plain link. HTML and scripts are not allowed.',
    publishNote:
      'Once published, it appears under the slides in the viewer for as long as the slides are public. After that, saving your edits here updates it at once. AI agents can only leave a draft.',
    saveDraft: 'Save draft',
    save: 'Save',
    publish: 'Publish',
    unpublish: 'Unpublish',
    previewEmpty: 'There is no text yet.',
    saved: 'Saved.',
    published_: 'Published.',
    unpublished: 'Unpublished. The article is a draft again.',
    tooLong: (shown: string) =>
      `The text can have at most ${shown} characters. It was not saved. Shorten it and save again.`,
    empty: 'The text is empty. Write something to publish it.',
    missing: (url: string, last: number) =>
      `The page at ${url} is not in the current version (it has ${last} pages). Readers see a plain link instead of the page image.`,
    length: (count: string, max: string) => `${count} / ${max} characters`,
    lastSaved: (day: string) => `Last saved: ${day}`,
  },
})

/**
 * The box for the text. Its first line break is not part of the text, so one
 * is put in front: a text that starts with a blank line keeps it. Built as a
 * plain string so that no formatter puts another line break there.
 */
const articleInput = (body: string) =>
  raw(
    '<textarea class="article-input" id="article-body" name="body" rows="18" ' +
      'spellcheck="false" aria-describedby="article-note">\n' +
      String(html`${body}`) +
      '</textarea>',
  )

/** What the editing page tells the author about what they just did. */
export type EditNotice =
  | 'saved'
  | 'published'
  | 'unpublished'
  | 'too_long'
  | 'empty'

/** What the editing page shows. */
export type EditView = Readonly<{
  slug: string
  /** The title of the slides, or their URL name. */
  deckName: string
  /** What is saved; null before the first save. */
  article: StoredArticle | null
  /** The text in the box: what was saved, or what the author just sent. */
  body: string
  notice: EditNotice | null
  /** The pages of the article's own slides that the version does not have. */
  missing: readonly PageRef[]
  /** How many pages the version has; set only when `missing` is not empty. */
  pageCount: number | null
}>

/** The page title of the editing page, for renderPage. */
export const editTitle = (lang: Lang) => text[lang].title

const numbers = new Intl.NumberFormat('en-US')

export const statusChip = (status: ArticleStatus, lang: Lang) =>
  html`<span
    class="status-chip ${status === 'published' ? 'status-public' : 'status-draft'}"
    >${status === 'published' ? text[lang].published : text[lang].draft}</span
  >`

function notice(view: EditView, lang: Lang) {
  const t = text[lang]
  if (view.notice === null) return ''
  const words = {
    saved: t.saved,
    published: t.published_,
    unpublished: t.unpublished,
    too_long: t.tooLong(numbers.format(MAX_ARTICLE_CHARS)),
    empty: t.empty,
  }[view.notice]
  const bad = view.notice === 'too_long' || view.notice === 'empty'
  return html`<p
    class="${bad ? 'notice-danger' : 'notice-success'}"
    role="${bad ? 'alert' : 'status'}"
  >
    ${words}
  </p>`
}

/**
 * The editing page of one slide's article: a box for the Markdown and a
 * tab for the preview, which is the viewer itself (`viewer-preview-routes.ts`).
 * Every button sends the form, so the text is never lost: not on the preview,
 * nor when it was too long to save. The
 * page needs no script of its own; /share.js asks before the page is left
 * with changes that were not saved.
 */
export function editBody(view: EditView, lang: Lang) {
  const t = text[lang]
  const status = view.article?.status ?? null
  const unsaved = view.body !== (view.article?.body ?? '')
  return html`<div class="article-edit">
    <p>
      <a class="back-link" href="/slides/${view.slug}"
        >${t.back(view.deckName)}</a
      >
    </p>
    <div class="article-edit-head">
      <h1>${t.heading}</h1>
      ${status ? statusChip(status, lang) : ''}
    </div>
    ${notice(view, lang)}
    <form
      method="post"
      action="/slides/${view.slug}/article"
      data-unsaved-guard
      data-dirty="${unsaved ? 'true' : 'false'}"
    >
      <div class="article-tabs" role="tablist" aria-label="${t.tabs}">
        <button
          type="submit"
          name="action"
          value="write"
          role="tab"
          aria-selected="true"
          class="button-primary"
        >
          ${t.write}
        </button>
        <button
          type="submit"
          name="action"
          value="preview"
          role="tab"
          aria-selected="false"
          class="button-secondary"
        >
          ${t.preview}
        </button>
      </div>
      <div>
        <label for="article-body">${t.body}</label>
        ${articleInput(view.body)}
        <p class="field-note" id="article-note">${t.note}</p>
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
      <div class="article-actions">
        <button
          class="button-secondary"
          type="submit"
          name="action"
          value="save"
        >
          ${status === 'published' ? t.save : t.saveDraft}
        </button>
        ${
          status === 'published'
            ? html`<button
                class="button-secondary"
                type="submit"
                name="action"
                value="unpublish"
              >
                ${t.unpublish}
              </button>`
            : html`<button
                class="button-primary"
                type="submit"
                name="action"
                value="publish"
              >
                ${t.publish}
              </button>`
        }
      </div>
    </form>
    <p class="field-note article-publish-note">${t.publishNote}</p>
    <style>
      .article-edit {
        max-width: 840px;
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
        margin: 0;
      }
      .article-tabs {
        display: flex;
        gap: 8px;
        margin: 24px 0 16px;
      }
      .article-input {
        max-width: none;
        min-height: 320px;
        font-family: var(--font-mono);
        font-size: 14px;
        line-height: 1.7;
        resize: vertical;
      }
      .article-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin: 24px 0 16px;
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
    ${article ? statusChip(article.status, lang) : ''}
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
