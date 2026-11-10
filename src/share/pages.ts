import { html } from 'hono/html'
import { otherLangLinks, siteFooter } from '../site/footer'
import { messages, type Lang } from '../site/i18n'
import { SERVICE_NAME } from '../site/service'

const text = messages({
  ja: {
    shareUrl: '共有 URL',
    copy: 'リンクをコピー',
    copied: 'コピーしました',
    openContent: '資料だけを開く',
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
    openContent: 'Open the slides alone',
    language: 'Language',
    unavailableTitle: 'Slides not available',
    unavailableHeading: 'These slides are not available',
    unavailableHint:
      'Check that the URL is correct, or the author may have stopped sharing them.',
  },
})

/**
 * The viewer runs only service markup and its own script. Author files load
 * in the iframe from the deployment's origin, which is the only frame source.
 */
export const viewerPolicy = (contentOrigin: string) =>
  [
    "default-src 'none'",
    `frame-src ${contentOrigin}`,
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

const style = html`<style>
  html,
  body {
    margin: 0;
    height: 100%;
    font: 15px system-ui;
    color: #152439;
    background: #f4f6fa;
  }
  body {
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
  }
  header .name {
    font-weight: 600;
    margin-right: auto;
    overflow-wrap: anywhere;
  }
  header input {
    font: inherit;
    min-width: 0;
    flex: 1 1 16em;
    max-width: 28em;
  }
  header .name a {
    padding: 0;
    color: inherit;
  }
  button,
  header a {
    font: inherit;
    padding: 4px 10px;
  }
  iframe {
    flex: 1;
    width: 100%;
    min-height: 0;
    border: 0;
    background: white;
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
 * iframe sandboxed without top navigation, popups, downloads, or forms.
 */
export function viewerPage(
  view: {
    handle: string
    slug: string
    title: string | null
    shareUrl: string
    contentUrl: string
  },
  lang: Lang,
  url: URL,
) {
  const t = text[lang]
  const pageTitle = `${view.title ?? view.slug} - @${view.handle} - ${SERVICE_NAME}`
  return html`<!doctype html>
    <html lang="${lang}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${pageTitle}</title>
        ${style}
        <script src="/share.js" defer></script>
      </head>
      <body>
        <header>
          <span class="name"
            ><a href="/@${view.handle}">@${view.handle}</a> /
            ${view.title ?? view.slug}</span
          >
          <input
            id="share-url"
            aria-label="${t.shareUrl}"
            readonly
            value="${view.shareUrl}"
          />
          <button type="button" data-copy="share-url" data-copied="${t.copied}">
            ${t.copy}
          </button>
          <a href="${view.contentUrl}">${t.openContent}</a>
          <span class="langs" role="group" aria-label="${t.language}"
            >${otherLangLinks(lang, url)}</span
          >
        </header>
        <iframe
          src="${view.contentUrl}"
          title="${view.title ?? view.slug}"
          sandbox="allow-scripts allow-same-origin"
          allow="fullscreen"
          referrerpolicy="no-referrer"
          data-autofocus
        ></iframe>
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
