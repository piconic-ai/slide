import { html } from 'hono/html'
import type { ViewerAuthorState } from '../follows/pages'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    actions: '操作',
    fullscreen: '全画面',
    share: '共有',
    shareUrl: '共有 URL',
    copyUrl: 'URL をコピー',
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
    fullscreen: 'Full screen',
    share: 'Share',
    shareUrl: 'Share link',
    copyUrl: 'Copy link',
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
  /** The share path, such as /@kfly8/good-slide. */
  slide: string
  shareUrl: string
  controls: ViewerAuthorState
}>

function muteMenuItem(view: ViewerActionsView, lang: Lang) {
  if (view.controls === 'none') return ''
  const t = text[lang]
  const { handle, slide } = view
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
 * The share menu. For now it holds the one action that existed, copying the
 * share URL; posting, the page's own URL and the embed code are added by the
 * share feature. The URL sits in a read-only field that /share.js copies
 * from and keeps on the page the reader is looking at. The field is shown,
 * so that where the clipboard is refused the URL can be selected in it and
 * copied by hand.
 */
const shareMenu = (view: ViewerActionsView, lang: Lang) => {
  const t = text[lang]
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
      <button type="button" data-copy="share-url" data-copied="${t.copied}">
        ${t.copyUrl}
      </button>
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
        href="/reports/new?slide=${encodeURIComponent(view.slide)}"
        >${t.report}</a
      >
      ${muteMenuItem(view, lang)}
    </div>
  </details>`
}

/**
 * The viewer's three actions, right of the title: full screen, share, and
 * the rest. Full screen stays hidden where the browser cannot do it.
 */
export const viewerActions = (view: ViewerActionsView, lang: Lang) => {
  const t = text[lang]
  return html`<div
    class="viewer-actions"
    role="group"
    aria-label="${t.actions}"
  >
    <button
      type="button"
      class="button-secondary"
      data-fullscreen="deck"
      hidden
    >
      ${t.fullscreen}
    </button>
    ${shareMenu(view, lang)} ${moreMenu(view, lang)}
  </div>`
}
