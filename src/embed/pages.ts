import { html } from 'hono/html'
import { designTokensCssRaw } from '../site/design-tokens'
import { messages, type Lang } from '../site/i18n'
import { SERVICE_NAME } from '../site/service'

const text = messages({
  ja: { open: `${SERVICE_NAME} で開く` },
  en: { open: `Open on ${SERVICE_NAME}` },
})

/**
 * The one service page any site may frame. Like the viewer, it runs only
 * service markup and the service's own script, and frames author files from
 * the deployment's origin alone. Unlike the viewer it asks the service
 * nothing and sends no form: it names no source for requests, so nothing in
 * it can act for a signed-in reader.
 */
export const embedPolicy = (contentOrigin: string) =>
  [
    "default-src 'none'",
    `frame-src ${contentOrigin}`,
    "script-src 'self'",
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
    'frame-ancestors *',
  ].join('; ')

const style = html`<style>
  ${designTokensCssRaw} html,
  body {
    height: 100%;
    margin: 0;
  }
  body {
    display: flex;
    flex-direction: column;
    background: var(--background);
    color: var(--foreground);
    font: 14px/1.4 var(--font-sans);
  }
  /* The slides take all the height the line under them leaves. */
  iframe {
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
    border: 0;
    background: var(--stage);
  }
  .embed-line {
    display: flex;
    flex: none;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    margin: 0;
    padding: 0 12px;
    border-top: 1px solid var(--border);
    white-space: nowrap;
  }
  .embed-title,
  .embed-author {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .embed-title {
    flex: 0 1 auto;
    min-width: 0;
    font-weight: 700;
  }
  .embed-author {
    flex: 0 2 auto;
    min-width: 0;
    color: var(--muted-foreground);
  }
  .embed-line a {
    display: inline-flex;
    flex: none;
    align-items: center;
    min-height: 44px;
    margin-left: auto;
    color: inherit;
    font-weight: 600;
  }
</style>`

/** What the page to frame shows of public slides. */
export type EmbedView = Readonly<{
  handle: string
  /** The title of the slides, or their name in the URL. */
  name: string
  /** The author's name, when their profile has one. */
  authorName: string | null
  /** The viewer of the slides, on the page the frame starts at. */
  shareUrl: string
  contentUrl: string
}>

/**
 * The page a site frames to show public slides in an article: the slides,
 * and one line under them with the title, the author and a link that opens
 * the viewer in a new tab. Following, reporting and muting are done there;
 * nothing here uses the reader's session. The slides run in the same
 * sandboxed frame as in the viewer, so they cannot move the page around
 * them, open a tab or send a form.
 */
export const embedPage = (view: EmbedView, lang: Lang) =>
  html`<!doctype html>
    <html lang="${lang}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${view.name} - @${view.handle} - ${SERVICE_NAME}</title>
        <link rel="canonical" href="${view.shareUrl}" />
        ${style}
        <script src="/embed.js" defer></script>
      </head>
      <body>
        <iframe
          id="deck"
          src="${view.contentUrl}"
          title="${view.name}"
          sandbox="allow-scripts allow-same-origin"
          allow="fullscreen"
          referrerpolicy="no-referrer"
        ></iframe>
        <p class="embed-line">
          <span class="embed-title">${view.name}</span>
          <span class="embed-author"
            >${view.authorName ?? `@${view.handle}`}</span
          >
          <a href="${view.shareUrl}" target="_blank" rel="noopener"
            >${text[lang].open}</a
          >
        </p>
      </body>
    </html>`
