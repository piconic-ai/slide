import { html } from 'hono/html'

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
  main {
    max-width: 640px;
    margin: 12vh auto;
    padding: 0 16px;
  }
</style>`

/**
 * The trusted viewer of a public deck. The deck runs in a cross-origin
 * iframe sandboxed without top navigation, popups, downloads, or forms.
 */
export function viewerPage(view: {
  handle: string
  slug: string
  shareUrl: string
  contentUrl: string
}) {
  return html`<!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${view.slug} - @${view.handle} - Slide</title>
        ${style}
        <script src="/share.js" defer></script>
      </head>
      <body>
        <header>
          <span class="name">@${view.handle} / ${view.slug}</span>
          <input
            id="share-url"
            aria-label="共有 URL"
            readonly
            value="${view.shareUrl}"
          />
          <button type="button" data-copy="share-url">リンクをコピー</button>
          <a href="${view.contentUrl}">資料だけを開く</a>
        </header>
        <iframe
          src="${view.contentUrl}"
          title="${view.slug}"
          sandbox="allow-scripts allow-same-origin"
          allow="fullscreen"
          referrerpolicy="no-referrer"
          data-autofocus
        ></iframe>
      </body>
    </html>`
}

export const unavailablePage = html`<!doctype html>
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>資料は公開されていません - Slide</title>
      ${style}
    </head>
    <body>
      <main>
        <h1>この資料は公開されていません</h1>
        <p>URL が正しいか、作者が公開を停止していないかを確認してください。</p>
      </main>
    </body>
  </html>`
