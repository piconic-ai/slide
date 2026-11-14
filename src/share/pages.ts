import { html } from 'hono/html'
import { otherLangLinks, siteFooter } from '../site/footer'
import { messages, type Lang } from '../site/i18n'
import { SERVICE_NAME } from '../site/service'
import {
  citationSections,
  timelinePanel,
  type ReactionsView,
} from '../reactions/pages'

const text = messages({
  ja: {
    shareUrl: '共有 URL',
    copy: 'リンクをコピー',
    copied: 'コピーしました',
    fullscreen: '全画面で見る',
    language: '表示言語',
    unavailableTitle: '資料は公開されていません',
    unavailableHeading: 'この資料は公開されていません',
    unavailableHint:
      'URL が正しいか、作者が公開を停止していないかを確認してください。',
  },
  en: {
    shareUrl: 'Share link',
    copy: 'Copy link',
    copied: 'Copied',
    fullscreen: 'Full screen',
    language: 'Language',
    unavailableTitle: 'Slides not available',
    unavailableHeading: 'These slides are not available',
    unavailableHint:
      'Check that the URL is correct, or the author may have stopped sharing them.',
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
  .stage .author {
    margin: 0 0 8px;
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
  .mini iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    transform-origin: top left;
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
    .timeline {
      margin-left: 12px;
      margin-right: 12px;
    }
    .timeline {
      max-height: none;
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
 * The trusted viewer of a public deck. The deck runs in a cross-origin
 * iframe sandboxed without top navigation, popups, downloads, or forms. Its
 * timeline of reactions sits beside it, so both show in the first screen.
 */
export function viewerPage(
  view: {
    handle: string
    slug: string
    title: string | null
    shareUrl: string
    contentUrl: string
    reactions: ReactionsView
  },
  lang: Lang,
  url: URL,
) {
  const t = text[lang]
  const name = view.title ?? view.slug
  return html`<!doctype html>
    <html lang="${lang}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${name} - @${view.handle} - ${SERVICE_NAME}</title>
        ${style}
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
              src="${view.contentUrl}"
              title="${name}"
              sandbox="allow-scripts allow-same-origin"
              allow="fullscreen"
              referrerpolicy="no-referrer"
              data-autofocus
            ></iframe>
            <h1>${name}</h1>
            <p class="author">
              <a href="/@${view.handle}">@${view.handle}</a>
            </p>
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
            ${citationSections(view.reactions, lang)}
          </div>
          ${timelinePanel(view.reactions, lang)}
        </div>
      </body>
    </html>`
}

export const unavailablePage = (lang: Lang, url: URL) => {
  const t = text[lang]
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
