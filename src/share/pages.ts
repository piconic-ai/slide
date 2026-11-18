import { html } from 'hono/html'
import { followLink, type ViewerAuthorState } from '../follows/pages'
import { otherLangLinks, siteFooter } from '../site/footer'
import { messages, type Lang } from '../site/i18n'
import { SERVICE_NAME } from '../site/service'
import {
  citationSections,
  timelinePanel,
  type ReactionsView,
} from '../reactions/pages'
import { eventLines, eventSections, type EventView } from '../events/pages'

const text = messages({
  ja: {
    shareUrl: '共有 URL',
    copy: 'リンクをコピー',
    copied: 'コピーしました',
    report: '通報する',
    mute: 'この作者をミュート',
    muted: 'ミュート中',
    muteEffect: 'この作者のスライドが、あなたに表示される一覧から外れます',
    release: '解除',
    releaseMute: (handle: string) => `@${handle} のミュートを解除`,
    more: 'メニュー',
    fullscreen: '全画面で見る',
    language: '表示言語',
    unavailableTitle: '資料は公開されていません',
    unavailableHeading: 'この資料は公開されていません',
    unavailableHint:
      'URL が正しいか、作者が公開を停止していないかを確認してください。',
    profileMissingTitle: 'ページが見つかりません',
    profileMissingHeading: 'このページは見つかりません',
    profileMissingHint: 'URL が正しいかを確認してください。',
  },
  en: {
    shareUrl: 'Share link',
    copy: 'Copy link',
    copied: 'Copied',
    report: 'Report',
    mute: 'Mute this author',
    muted: 'Muted',
    muteEffect: 'This author’s slides will disappear from your lists.',
    release: 'Unmute',
    releaseMute: (handle: string) => `Unmute @${handle}`,
    more: 'Menu',
    fullscreen: 'Full screen',
    language: 'Language',
    unavailableTitle: 'Slides not available',
    unavailableHeading: 'These slides are not available',
    unavailableHint:
      'Check that the URL is correct, or the author may have stopped sharing them.',
    profileMissingTitle: 'Page not found',
    profileMissingHeading: 'This page was not found',
    profileMissingHint: 'Check that the URL is correct.',
  },
})

/**
 * The viewer runs only service markup and its own script. Author files load
 * in the iframe from the deployment's origin. The frame may also load the
 * service's own page that hands a followed share link to the viewer; see
 * followedLinkPage. The only other frame sources are the embed pages of the
 * services whose posts are on the timeline, and the origins of the decks
 * this deck cites, each shown in a frame of its own.
 */
export const viewerPolicy = (
  contentOrigin: string,
  embedOrigins: readonly string[] = [],
) =>
  [
    "default-src 'none'",
    `frame-src ${[contentOrigin, "'self'", ...embedOrigins].join(' ')}`,
    "script-src 'self'",
    "connect-src 'self'",
    "style-src 'unsafe-inline'",
    "img-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')

/** Shown alike for missing, draft and paused decks. */
export const UNAVAILABLE_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

/** Only the viewer may frame the page that hands it a followed link. */
export const followedLinkPolicy = (nonce: string) =>
  `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`

/**
 * Answers a share URL requested inside a frame. A deck cannot move the
 * viewer: its frame is sandboxed without top navigation. When a reader
 * follows a deck's link to another deck, the frame loads this page instead,
 * and its script asks the viewer to open the path. The viewer accepts the
 * request only from this origin and only for a share path, so a deck can
 * send readers to other decks here and nowhere else.
 */
export const followedLinkPage = (nonce: string) =>
  html`<!doctype html>
    <meta charset="utf-8" />
    <title>${SERVICE_NAME}</title>
    <script nonce="${nonce}">
      if (parent !== window)
        parent.postMessage(
          { type: 'slide:open', path: location.pathname },
          location.origin,
        )
    </script>`

const style = html`<style>
  html,
  body {
    margin: 0;
    font: 15px system-ui;
    color: #152439;
    background: #f4f6fa;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
  }
  header .brand {
    font-weight: 700;
    font-size: 17px;
    color: inherit;
    text-decoration: none;
    margin-right: auto;
  }
  button {
    font: inherit;
    padding: 4px 10px;
  }
  /* The slides and their timeline side by side, both in the first screen. */
  .watch {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 380px;
    gap: 16px;
    align-items: start;
    box-sizing: border-box;
    max-width: 1680px;
    margin: 0 auto;
    padding: 0 16px 48px;
  }
  .stage {
    min-width: 0;
  }
  .stage > iframe {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    max-height: calc(100vh - 190px);
    max-height: calc(100dvh - 190px);
    border: 0;
    border-radius: 10px;
    background: black;
  }
  .stage > iframe:fullscreen {
    max-height: none;
    border-radius: 0;
  }
  .stage h1 {
    font-size: 20px;
    line-height: 1.4;
    margin: 12px 0 4px;
    overflow-wrap: anywhere;
  }
  .titlerow {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }
  .titlerow h1 {
    min-width: 0;
  }
  /* What a reader rarely needs stays behind the menu. */
  .deck-menu {
    position: relative;
    flex: none;
    margin-top: 10px;
  }
  .deck-menu summary {
    list-style: none;
    cursor: pointer;
    min-width: 32px;
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 18px;
    line-height: 1.4;
    text-align: center;
  }
  .deck-menu summary::-webkit-details-marker {
    display: none;
  }
  .deck-menu summary:hover,
  .deck-menu[open] summary {
    background: rgba(127, 127, 127, 0.18);
  }
  .deck-menu .menu {
    position: absolute;
    right: 0;
    z-index: 1;
    min-width: 10em;
    padding: 4px;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 8px;
    background: white;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  }
  .deck-menu .menu a {
    display: block;
    padding: 6px 10px;
    border-radius: 6px;
    color: inherit;
    text-decoration: none;
    white-space: nowrap;
  }
  .deck-menu .mute-item {
    display: flex;
    align-items: baseline;
    white-space: nowrap;
  }
  .deck-menu [data-mute-status] {
    padding-left: 10px;
  }
  .deck-menu .mute-item a {
    flex: 1;
  }
  /* Beside the state, the action must read as something to press. */
  .deck-menu [data-mute-status] {
    color: #4f5f78;
  }
  .deck-menu .mute-item a[data-muted='true'] {
    flex: 0 0 auto;
    margin-left: auto;
    color: #153b70;
    font-weight: 600;
    text-decoration: underline;
  }
  .deck-menu .menu a:hover,
  .deck-menu .menu a:focus-visible {
    background: rgba(127, 127, 127, 0.18);
  }
  .stage .author {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    column-gap: 12px;
    overflow-wrap: anywhere;
    margin: 0 0 8px;
  }
  /* The follow control reads as a small button; its filled form invites, its outlined form reports. */
  .stage .author a[data-follow-handle] {
    padding: 1px 10px;
    border: 1px solid #153b70;
    border-radius: 999px;
    background: #153b70;
    color: white;
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;
  }
  .stage .author a[data-follow-handle][data-following='true'] {
    border-color: #c4cedd;
    background: white;
    color: #4f5f78;
  }
  .stage .author a[data-follow-handle][aria-busy] {
    opacity: 0.6;
  }
  .stage .author a[data-follow-handle]:focus-visible {
    outline: 2px solid #153b70;
    outline-offset: 2px;
  }
  .stage .description {
    max-width: 60em;
    margin: 0 0 10px;
    line-height: 1.7;
    overflow-wrap: anywhere;
  }
  .events {
    list-style: none;
    margin: 0 0 10px;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .events li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    line-height: 1.5;
  }
  .events .community {
    padding: 1px 10px;
    border: 1px solid #d6dde8;
    border-radius: 999px;
    background: white;
    font-weight: 700;
  }
  .events .community a {
    color: inherit;
    text-decoration: none;
  }
  .events time {
    color: #4f5f78;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .actions input {
    font: inherit;
    min-width: 0;
    flex: 1 1 16em;
    max-width: 28em;
  }
  .cites h2,
  .timeline h2 {
    font-size: 15px;
    margin: 0 0 8px;
  }
  .cites {
    margin-top: 20px;
  }
  [data-reader-lists]:not(:has(> section)) {
    display: none;
  }
  .cites ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }
  .mini {
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: 8px;
    background: black;
  }
  .mini iframe,
  .mini img:not([hidden]) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .mini iframe {
    border: 0;
    transform-origin: top left;
  }
  .mini img {
    object-fit: contain;
  }
  .cites .more {
    color: #4f5f78;
    font-size: 13px;
  }
  .cites p {
    margin: 6px 0 0;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  small {
    color: #4f5f78;
  }
  .timeline {
    box-sizing: border-box;
    max-height: calc(100vh - 72px);
    max-height: calc(100dvh - 72px);
    overflow-y: auto;
    padding: 12px;
    border: 1px solid #d6dde8;
    border-radius: 10px;
    background: white;
  }
  .timeline ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 12px;
  }
  .timeline p {
    margin: 0;
  }
  .timeline .empty {
    color: #4f5f78;
    line-height: 1.7;
  }
  .entry .embed {
    display: block;
    width: 100%;
    height: 280px;
    border: 0;
    border-radius: 12px;
    background: #f4f6fa;
  }
  @media (max-width: 900px) {
    .watch {
      grid-template-columns: minmax(0, 1fr);
      padding: 0 0 32px;
    }
    .stage > iframe {
      border-radius: 0;
    }
    .stage > :not(iframe),
    .stage > .author,
    .stage > .description,
    .timeline > :not(ol) {
      margin-left: 12px;
      margin-right: 12px;
    }
    /* Posts take the full width: an embed needs 300px even on a 320px screen. */
    .timeline {
      max-height: none;
      padding: 12px 0;
      border-width: 1px 0;
      border-radius: 0;
    }
  }
  @media (max-width: 480px) {
    .deck-menu .menu {
      position: static;
    }
    .deck-menu summary {
      width: fit-content;
      margin-left: auto;
    }
  }
  main,
  .page-end {
    box-sizing: border-box;
    width: 100%;
    max-width: 640px;
    margin: 12vh auto 0;
    padding: 0 16px;
  }
  .page-end {
    margin-top: 0;
  }
</style>`

/**
 * What a service shows when the share URL is posted there: the deck's own
 * title, description and cover image, as its author gave them in the deck.
 */
const linkPreview = (
  name: string,
  view: Readonly<{
    description: string | null
    shareUrl: string
    imageUrl: string
  }>,
) =>
  html`<meta property="og:type" content="article" />
    <meta property="og:site_name" content="${SERVICE_NAME}" />
    <meta property="og:title" content="${name}" />
    <meta property="og:url" content="${view.shareUrl}" />
    <meta property="og:image" content="${view.imageUrl}" />
    <meta name="twitter:card" content="summary_large_image" />
    ${
      view.description
        ? html`<meta name="description" content="${view.description}" />
            <meta property="og:description" content="${view.description}" />`
        : ''
    }`

function muteMenuItem(
  state: ViewerAuthorState,
  handle: string,
  slide: string,
  lang: Lang,
) {
  if (state === 'none') return ''
  const t = text[lang]
  const muted = state === 'muted'
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
 * The trusted viewer of a public deck. The deck runs in a cross-origin
 * iframe sandboxed without top navigation, popups, downloads, or forms. Its
 * timeline of reactions sits beside it, so both show in the first screen.
 */
export function viewerPage(
  view: {
    handle: string
    slug: string
    title: string | null
    description: string | null
    /** The deck's cover image, for services that preview the share URL. */
    imageUrl: string
    shareUrl: string
    contentUrl: string
    reactions: ReactionsView
    controls: ViewerAuthorState
    events: readonly EventView[]
  },
  lang: Lang,
  url: URL,
) {
  const t = text[lang]
  const name = view.title ?? view.slug
  const slide = new URL(view.shareUrl).pathname
  return html`<!doctype html>
    <html lang="${lang}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${name} - @${view.handle} - ${SERVICE_NAME}</title>
        ${linkPreview(name, view)} ${style}
        <script src="/share.js" defer></script>
      </head>
      <body>
        <header>
          <a class="brand" href="/">${SERVICE_NAME}</a>
          <span class="langs" role="group" aria-label="${t.language}"
            >${otherLangLinks(lang, url)}</span
          >
        </header>
        <div class="watch">
          <div class="stage">
            <iframe
              id="deck"
              data-deck
              data-share="/@${view.handle}/${view.slug}"
              src="${view.contentUrl}"
              title="${name}"
              sandbox="allow-scripts allow-same-origin"
              allow="fullscreen"
              referrerpolicy="no-referrer"
              data-autofocus
            ></iframe>
            <div class="titlerow">
              <h1>${name}</h1>
              <details class="deck-menu">
                <summary aria-label="${t.more}">⋯</summary>
                <div class="menu">
                  <a
                    data-slide-return
                    href="/reports/new?slide=${encodeURIComponent(slide)}"
                    >${t.report}</a
                  >
                  ${muteMenuItem(view.controls, view.handle, slide, lang)}
                </div>
              </details>
            </div>
            <p class="author">
              <a href="/@${view.handle}">@${view.handle}</a>
              ${followLink(view.controls, view.handle, slide, lang)}
            </p>
            ${
              view.description
                ? html`<p class="description">${view.description}</p>`
                : ''
            }
            ${eventLines(view.events, lang)}
            <p class="actions">
              <button type="button" data-fullscreen="deck" hidden>
                ${t.fullscreen}
              </button>
              <input
                id="share-url"
                aria-label="${t.shareUrl}"
                readonly
                value="${view.shareUrl}"
              />
              <button
                type="button"
                data-copy="share-url"
                data-copied="${t.copied}"
              >
                ${t.copy}
              </button>
            </p>
            <div data-reader-lists="event-talks">
              ${eventSections(view.events, lang)}
            </div>
            ${citationSections(view.reactions, lang)}
          </div>
          ${timelinePanel(view.reactions, lang)}
        </div>
      </body>
    </html>`
}

/** Which kind of share path could not be shown. */
export type UnavailableKind = 'deck' | 'profile'

/**
 * The page for a share path readers cannot open. A deck's page does not say
 * why, and a profile's page reads the same for a handle nobody holds and
 * for an account an operator suspended.
 */
export const unavailablePage = (
  lang: Lang,
  url: URL,
  kind: UnavailableKind = 'deck',
) => {
  const all = text[lang]
  const t =
    kind === 'profile'
      ? {
          unavailableTitle: all.profileMissingTitle,
          unavailableHeading: all.profileMissingHeading,
          unavailableHint: all.profileMissingHint,
        }
      : all
  return html`<!doctype html>
    <html lang="${lang}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${t.unavailableTitle} - ${SERVICE_NAME}</title>
        ${style}
      </head>
      <body>
        <main>
          <h1>${t.unavailableHeading}</h1>
          <p>${t.unavailableHint}</p>
        </main>
        <div class="page-end">${siteFooter(lang, url)}</div>
      </body>
    </html>`
}
