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
    body: '記事の本文(Markdown)',
    placeholder: '発表で話したことを書きます。Markdown が使えます。',
    guide: 'Markdown ガイド',
    preview: 'ビューアーで見る',
    publish: '記事を公開する',
    update: '公開記事を更新',
    discard: '変更を取り消す',
    unpublish: '記事の公開を止める',
    updated: '公開記事を更新しました。',
    discarded: '変更を取り消しました。公開中の本文に戻りました。',
    stale:
      '別のタブで更新されています。再読み込みすると、最新の本文になります。いまの入力はコピーしてから再読み込みしてください。この画面では、自動では保存しません。',
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
    conflict:
      '別のタブで更新されています。再読み込みすると、最新の本文になります。いまの入力はコピーしてから再読み込みしてください',
    invalid: '保存できませんでした。再読み込みしてください',
    signedOut: 'ログインが切れました。再読み込みしてログインしてください',
    gone: 'このスライドは見つかりません',
    tooLongLive: '本文が長すぎるため、保存できません',
  },
  en: {
    title: 'Edit the article',
    back: (name: string) => `‹ Manage “${name}”`,
    heading: 'Article',
    draft: 'Draft',
    published: 'Published',
    pending: 'Changes not shown yet',
    body: 'Article text (Markdown)',
    placeholder: 'Write what you said in the talk. Markdown works.',
    guide: 'Markdown guide',
    preview: 'View in viewer',
    publish: 'Publish the article',
    update: 'Update published article',
    discard: 'Undo changes',
    unpublish: 'Stop publishing the article',
    updated: 'The published article is updated.',
    discarded: 'Changes undone. The published text is back.',
    stale:
      'It was updated in another tab. Reloading brings the latest text. Copy what you typed before you reload. This page does not save by itself now.',
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
    conflict:
      'It was updated in another tab. Reloading brings the latest text. Copy what you typed before you reload',
    invalid: 'Could not save. Reload this page',
    signedOut: 'You were signed out. Reload this page and sign in',
    gone: 'These slides were not found',
    tooLongLive: 'The text is too long to save',
  },
})

/**
 * The box for the text. Its first line break is not part of the text, so one
 * is put in front: a text that starts with a blank line keeps it. Built as a
 * plain string so that no formatter puts another line break there.
 */
const articleInput = (body: string, lang: Lang) =>
  raw(
    '<textarea class="article-input" id="article-body" name="body" rows="24" ' +
      `spellcheck="false" aria-label="${String(html`${text[lang].body}`)}" ` +
      `placeholder="${String(html`${text[lang].placeholder}`)}">\n` +
      String(html`${body}`) +
      '</textarea>',
  )

/** What the editing page tells the author about what they just did. */
export type EditNotice =
  | 'updated'
  | 'discarded'
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
    updated: t.updated,
    discarded: t.discarded,
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
const button = (value: string, label: string, kind: 'primary' | 'secondary') =>
  html`<button
    class="button-${kind}"
    type="submit"
    name="action"
    value="${value}"
  >
    ${label}
  </button>`

/**
 * The buttons under the box: for a publication, update it with the text in
 * the box, or undo the changes; for a draft, none, as the box is kept by
 * itself (publishing and stopping are on the slide's page). Both work
 * without the page's script, from the text in the box.
 */
function actions(state: ArticleState, lang: Lang) {
  const t = text[lang]
  if (state !== 'published' && state !== 'pending') return ''
  return html`<div class="article-actions">
    ${button('update', t.update, 'primary')}
    ${button('discard', t.discard, 'secondary')}
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
    data-text-invalid="${t.invalid}"
    data-text-signed-out="${t.signedOut}"
    data-text-gone="${t.gone}"
    data-stopped="${view.notice === 'stale' ? 'true' : 'false'}"
  >
    <div class="article-top">
      <a class="back-link" href="/slides/${view.slug}"
        >${t.back(view.deckName)}</a
      >
      <button
        class="button-secondary"
        type="submit"
        form="article-form"
        name="action"
        value="preview"
      >
        ${t.preview}
      </button>
    </div>
    <h1 class="visually-hidden">${t.title}</h1>
    ${notice(view, lang)}
    <div class="article-toolbar">
      <span class="article-state" data-state-chips
        >${stateChips(state, lang)}</span
      >
      <span class="article-saved" data-autosave-status role="status"></span>
      <a class="article-guide" href="/help#article">${t.guide}</a>
    </div>
    <div class="article-split">
      <form
        id="article-form"
        method="post"
        action="/slides/${view.slug}/article"
        data-unsaved="${unsaved ? 'true' : 'false'}"
      >
        <input
          type="hidden"
          name="revision"
          value="${view.revision === null ? '' : String(view.revision)}"
        />
        ${articleInput(view.body, lang)}
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
        margin-top: 0;
      }
      /* The row sits 16px under the header's line, as the first row of the
         slide's page does. */
      .article-top {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 4px 16px;
        margin-top: 16px;
      }
      .article-top .back-link {
        margin-top: 0;
      }
      /* One row above the box and the article beside it: the state on the
         left, how the box was kept after it, the guide on the right. */
      .article-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 12px;
        margin: 8px 0 4px;
      }
      .article-state .status-chip {
        margin: 0 8px 0 0;
      }
      .article-toolbar [hidden] {
        display: none;
      }
      .article-saved {
        color: var(--muted-foreground);
        font-size: 13px;
      }
      .article-guide {
        display: inline-flex;
        align-items: center;
        min-height: 44px;
        margin-left: auto;
        font-size: 13px;
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
  const state = stateOf(article)
  return html`<section class="panel panel-compact" data-deck-frame="article">
    <div class="article-frame-head">
      <h2>${t.heading}</h2>
      ${stateChips(state, lang)}
      ${
        article
          ? html`<span class="article-frame-info">
              ${t.lastSaved(dayFormats[lang].format(new Date(article.updatedAt * 1000)))}
              ·
              ${t.length(numbers.format(length), numbers.format(MAX_ARTICLE_CHARS))}
            </span>`
          : ''
      }
      <div class="article-frame-actions">
        <a class="button-secondary" href="/slides/${slug}/article"
          >${article ? frameText[lang].edit : frameText[lang].write}</a
        >
        ${article ? publicationForm(slug, article, state, lang) : ''}
      </div>
    </div>
    <style>
      /* One row where it fits: the heading, the state and what was saved on the
         left, the buttons at the right end; the buttons go under on a narrow
         screen. */
      .article-frame-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 12px;
      }
      .article-frame-head h2,
      .article-frame-head .status-chip {
        margin: 0;
      }
      .article-frame-info {
        color: var(--muted-foreground);
        font-size: 13px;
        line-height: 1.6;
      }
      .article-frame-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 12px;
        margin-left: auto;
      }
      .article-frame-actions form {
        margin: 0;
      }
    </style>
  </section>`
}

/**
 * Publishing the saved article, or stopping it, from the slide's page. The
 * button acts on what is kept, not on the box of the editing page, at the
 * revision this page was drawn at: a page that is behind is refused.
 */
function publicationForm(
  slug: string,
  article: StoredArticle,
  state: ArticleState,
  lang: Lang,
) {
  const t = text[lang]
  const draft = state === 'draft'
  return html`<form method="post" action="/slides/${slug}/article/publication">
    <input type="hidden" name="revision" value="${String(article.revision)}" />
    <button
      class="${draft ? 'button-primary' : 'button-secondary'}"
      type="submit"
      name="action"
      value="${draft ? 'publish' : 'unpublish'}"
      data-once
    >
      ${draft ? t.publish : t.unpublish}
    </button>
  </form>`
}

const refusalText = messages({
  ja: {
    title: '操作できませんでした',
    stale:
      '別のタブで更新されています。スライドの管理画面を再読み込みして、もう一度試してください。何も変わっていません。',
    empty:
      '本文が空です。記事を書いてから公開してください。何も変わっていません。',
    back: 'スライドの管理に戻る',
  },
  en: {
    title: 'Could not do that',
    stale:
      'It was updated in another tab. Reload the slide’s page and try again. Nothing changed.',
    empty:
      'The text is empty. Write the article before you publish it. Nothing changed.',
    back: 'Back to the slide’s page',
  },
})

/** What the slide's page says when a button of its article frame is refused. */
export const refusalBody = (
  slug: string,
  reason: 'stale' | 'empty',
  lang: Lang,
) =>
  html`<h1>${refusalText[lang].title}</h1>
    <p class="notice-danger" role="alert">${refusalText[lang][reason]}</p>
    <p><a href="/slides/${slug}">${refusalText[lang].back}</a></p>`

const frameText = messages({
  ja: {
    edit: '記事を編集する',
    write: '記事を書く',
  },
  en: {
    edit: 'Edit the article',
    write: 'Write the article',
  },
})
