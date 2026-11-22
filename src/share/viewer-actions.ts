import { html } from 'hono/html'
import type { ViewerAuthorState } from '../follows/pages'
import { copyLabel } from '../site/copy-row'
import { messages, type Lang } from '../site/i18n'
import { loginPrompt, loginPromptTrigger } from '../site/login-prompt'
import { postPrefixes, postUrl } from './share-links'
import { viewerLayoutMenu } from './viewer-layout-menu'

const text = messages({
  ja: {
    actions: '操作',
    edit: '編集する',
    fullscreen: '全画面',
    share: '共有',
    shareUrl: '共有 URL',
    copyUrl: 'URL をコピー',
    pageUrl: 'いま見ているページの URL',
    copyPageUrl: 'いま見ているページの URL をコピー',
    postX: 'X に投稿',
    postBluesky: 'Bluesky に投稿',
    embedCode: '埋め込みコード',
    copyEmbedCode: '埋め込みコードをコピー',
    otherApps: 'ほかのアプリで共有',
    copied: 'コピーしました',
    more: 'そのほかの操作',
    report: '通報する',
    mute: 'この作者をミュート',
    muted: 'ミュート中',
    muteEffect: 'この作者のスライドが、あなたに表示される一覧から外れます',
    release: '解除',
    releaseMute: (handle: string) => `@${handle} のミュートを解除`,
  },
  en: {
    actions: 'Actions',
    edit: 'Edit',
    fullscreen: 'Full screen',
    share: 'Share',
    shareUrl: 'Share link',
    copyUrl: 'Copy link',
    pageUrl: 'Link to this page',
    copyPageUrl: 'Copy link to this page',
    postX: 'Post to X',
    postBluesky: 'Post to Bluesky',
    embedCode: 'Embed code',
    copyEmbedCode: 'Copy embed code',
    otherApps: 'Share with another app',
    copied: 'Copied',
    more: 'More actions',
    report: 'Report',
    mute: 'Mute this author',
    muted: 'Muted',
    muteEffect: 'This author’s slides will disappear from your lists.',
    release: 'Unmute',
    releaseMute: (handle: string) => `Unmute @${handle}`,
  },
})

/** What the viewer's actions need to know about the slides shown. */
export type ViewerActionsView = Readonly<{
  handle: string
  /** The title shown above the actions, which a post starts with. */
  title: string
  /** The share path, such as /@kfly8/good-slide. */
  slide: string
  /** The share URL of the slides as a whole, without a page number. */
  shareUrl: string
  /** The code that embeds the slides in another site; null unless public. */
  embedCode: string | null
  controls: ViewerAuthorState
  /** Slides not yet public: only full screen, with no sharing or reporting. */
  preview?: boolean
  /** The author's own page for these slides; null for everyone else. */
  editPath: string | null
}>

function muteMenuItem(view: ViewerActionsView, lang: Lang) {
  if (view.controls === 'none') return ''
  const t = text[lang]
  const { handle, slide } = view
  if (view.controls === 'signed-out')
    return html`<div class="mute-item">
      <a
        data-slide-return
        ${loginPromptTrigger('mute')}
        href="/mutes/new?${new URLSearchParams({ handle, slide })}"
        title="${t.muteEffect}"
        >${t.mute}</a
      >
    </div>`
  const muted = view.controls === 'muted'
  const muteHref = `/mutes/new?${new URLSearchParams({ handle, slide })}`
  const releaseHref = '/settings#mutes'
  const releaseName = t.releaseMute(handle)
  return html`<div class="mute-item">
    <span data-mute-status ${muted ? '' : 'hidden'}>${t.muted}</span>
    <a
      data-slide-return
      data-mute-handle="${handle}"
      data-muted="${String(muted)}"
      data-mute-href="${muteHref}"
      data-release-href="${releaseHref}"
      data-mute-label="${t.mute}"
      data-mute-effect="${t.muteEffect}"
      data-release-label="${t.release}"
      data-release-name="${releaseName}"
      href="${muted ? releaseHref : muteHref}"
      title="${muted ? releaseName : t.muteEffect}"
      aria-label="${muted ? releaseName : t.mute}"
      >${muted ? t.release : t.mute}</a
    >
  </div>`
}

/**
 * The share menu: copying the URL of the slides, copying the URL of the
 * page on screen, posting to X or Bluesky, and handing the URL to another
 * app. /share.js keeps the page's URL and the post links on the page the
 * reader is looking at.
 *
 * - The URL of the slides sits in a read-only field that is shown, so that
 *   where the clipboard is refused it can be selected there and copied by
 *   hand. The page's URL has a field too, shown only in that case.
 * - Copying the page's URL stays hidden until the slides tell their page;
 *   slides without the script for it never do.
 * - The post links start on the URL of the slides, which is what a post
 *   gets when the page is not known.
 * - Copying the embed code is offered only for slides that may be embedded:
 *   public ones. Its field, like the page's, shows only when needed.
 * - Sharing with another app stays hidden where the browser cannot do it.
 * - What was copied is said in the pressed button, which keeps its size so
 *   the menu does not move, and in the status line for a screen reader.
 */
const shareMenu = (view: ViewerActionsView, lang: Lang) => {
  const t = text[lang]
  const post = postPrefixes(view.title)
  const copy = html`data-copied="${t.copied}" data-copy-status="share-status"`
  return html`<details class="action-menu share-menu" data-menu>
    <summary class="button-primary" aria-expanded="false">${t.share}</summary>
    <div class="menu-items">
      <input
        class="text-input"
        id="share-url"
        aria-label="${t.shareUrl}"
        readonly
        value="${view.shareUrl}"
      />
      <button type="button" data-copy="share-url" ${copy}>
        ${copyLabel(t.copyUrl, t.copied)}
      </button>
      <input
        class="text-input"
        id="share-page-url"
        aria-label="${t.pageUrl}"
        readonly
        hidden
        value="${view.shareUrl}"
      />
      <button
        type="button"
        data-share-page
        data-copy="share-page-url"
        ${copy}
        hidden
      >
        ${copyLabel(t.copyPageUrl, t.copied)}
      </button>
      <a
        data-share-post="${post.x}"
        href="${postUrl(post.x, view.shareUrl)}"
        target="_blank"
        rel="noopener noreferrer"
        >${t.postX}</a
      >
      <a
        data-share-post="${post.bluesky}"
        href="${postUrl(post.bluesky, view.shareUrl)}"
        target="_blank"
        rel="noopener noreferrer"
        >${t.postBluesky}</a
      >
      ${
        view.embedCode === null
          ? ''
          : html`<input
                class="text-input"
                id="embed-code"
                aria-label="${t.embedCode}"
                readonly
                hidden
                value="${view.embedCode}"
              />
              <button type="button" data-copy="embed-code" ${copy}>
                ${copyLabel(t.copyEmbedCode, t.copied)}
              </button>`
      }
      <button
        type="button"
        data-share-native
        data-share-title="${view.title}"
        hidden
      >
        ${t.otherApps}
      </button>
      <p class="share-status" id="share-status" role="status"></p>
    </div>
  </details>`
}

/** What a reader rarely needs: reporting the slides, muting their author. */
const moreMenu = (view: ViewerActionsView, lang: Lang) => {
  const t = text[lang]
  return html`<details class="action-menu more-menu" data-menu>
    <summary class="button-icon" aria-label="${t.more}" aria-expanded="false">
      <span aria-hidden="true">⋯</span>
    </summary>
    <div class="menu-items">
      <a
        data-slide-return
        ${view.controls === 'signed-out' ? loginPromptTrigger('report') : ''}
        href="/reports/new?slide=${encodeURIComponent(view.slide)}"
        >${t.report}</a
      >
      ${muteMenuItem(view, lang)}
    </div>
  </details>`
}

/**
 * The viewer's actions, right of the title: editing for the author alone,
 * then the layout, full screen, share, and the rest. Full screen stays hidden where the
 * browser cannot do it.
 */
export const viewerActions = (view: ViewerActionsView, lang: Lang) => {
  const t = text[lang]
  return html`<div
    class="viewer-actions"
    role="group"
    aria-label="${t.actions}"
  >
    ${
      view.editPath
        ? html`<a class="button-secondary" href="${view.editPath}"
            >${t.edit}</a
          >`
        : ''
    }
    ${viewerLayoutMenu(lang)}
    <button
      type="button"
      class="button-secondary"
      data-fullscreen="deck"
      hidden
    >
      ${t.fullscreen}
    </button>
    ${view.preview ? '' : html`${shareMenu(view, lang)} ${moreMenu(view, lang)}`}
    ${
      view.controls === 'signed-out' && !view.preview
        ? html`${loginPrompt('mute', view.slide, lang)}${loginPrompt('report', view.slide, lang)}`
        : ''
    }
  </div>`
}
