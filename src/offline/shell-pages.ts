import { html } from 'hono/html'
import { designTokensCssRaw } from '../site/design-tokens'
import { messages, type Lang } from '../site/i18n'
import { SERVICE_NAME } from '../site/service'
import { SHELL_SCRIPT_PATH, VIEWER_ATTRIBUTE } from './limits'

const text = messages({
  ja: {
    stored: '接続できないため、保存した版を表示しています。',
    reload: 'もう一度読み込む',
  },
  en: {
    stored: 'You are offline, so a stored version is shown.',
    reload: 'Load again',
  },
})

/**
 * Where the band goes, above the slides: an empty live region, so that what
 * is put into it is read out when it appears, and the band it is filled with
 * (F37-AC14, AC15). Nothing shows until a stored version is on screen.
 */
export const storedBandSlot = (lang: Lang) =>
  html`<div role="status" aria-live="polite" ${VIEWER_ATTRIBUTE.band}></div>
    <template ${VIEWER_ATTRIBUTE.bandTemplate}>
      <div class="viewer-notice">
        <p>${text[lang].stored}</p>
        <button class="button-primary" type="button" ${VIEWER_ATTRIBUTE.reload}>
          ${text[lang].reload}
        </button>
      </div>
    </template>`

/**
 * What the viewer keeps of a deck for the times it cannot be read: not the
 * viewer page, which is made for the reader who asked, but a small page that
 * holds the slides' frame and the band. It is the same for every reader.
 * The frame's address is set by its script, from the page asked for.
 */
export const offlineShell = (
  view: Readonly<{ title: string; contentOrigin: string }>,
  lang: Lang,
) =>
  html`<!doctype html>
    <html lang="${lang}" ${VIEWER_ATTRIBUTE.shell}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>${view.title} - ${SERVICE_NAME}</title>
        <style>
          ${designTokensCssRaw} body {
            margin: 0;
            font: 16px/1.8 var(--font-sans);
            color: var(--foreground);
            background: var(--background);
          }
          main {
            max-width: 1200px;
            margin: 0 auto;
            padding: 16px;
          }
          h1 {
            margin: 16px 0 0;
            font-size: 24px;
            line-height: 1.35;
          }
          .viewer-notice {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 12px 16px;
            margin: 0 0 16px;
            padding: 12px 16px;
            border: 2px solid var(--foreground);
            border-radius: var(--radius);
          }
          .viewer-notice p {
            margin: 0;
            font-weight: 700;
          }
          .button-primary {
            box-sizing: border-box;
            min-height: 44px;
            padding: 10px 20px;
            border: 0;
            border-radius: var(--radius-full);
            background: var(--primary);
            color: var(--primary-foreground);
            font: 600 15px/1.2 var(--font-sans);
            cursor: pointer;
          }
          iframe {
            display: block;
            width: 100%;
            aspect-ratio: 16 / 9;
            max-height: calc(100dvh - 190px);
            border: 0;
            border-radius: var(--radius);
            background: var(--stage);
          }
        </style>
      </head>
      <body>
        <main>
          ${storedBandSlot(lang)}
          <iframe
            data-offline-frame
            data-origin="${view.contentOrigin}"
            title="${view.title}"
            sandbox="allow-scripts allow-same-origin"
            allow="fullscreen"
            referrerpolicy="no-referrer"
          ></iframe>
          <h1>${view.title}</h1>
        </main>
        <script type="module" src="${SHELL_SCRIPT_PATH}"></script>
      </body>
    </html>`
