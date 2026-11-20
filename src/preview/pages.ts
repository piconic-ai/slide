import { html } from 'hono/html'
import { designTokensCssRaw } from '../site/design-tokens'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    reopenTitle: '開き直してください',
    reopen: (dashboard: string) =>
      html`この確認は期限切れか使用済みです。<a href="${dashboard}"
          >スライドの管理</a
        >から viewer を開き直してください。`,
  },
  en: {
    reopenTitle: 'Open it again',
    reopen: (dashboard: string) =>
      html`This check has expired or was already used. Open the viewer again
        from <a href="${dashboard}">your slides</a>.`,
  },
})

export const PREVIEW_COOKIE = '__Host-slide_preview'

/** Shown on the content origin when a launch or session is not usable. */
export const reopenPage = (decksUrl: string, lang: Lang) =>
  html`<!doctype html>
    <html lang="${lang}">
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width" />
      <meta name="robots" content="noindex" />
      <title>${text[lang].reopenTitle}</title>
      <style>
        ${designTokensCssRaw} body {
          font: 16px/1.8 var(--font-sans);
          max-width: 640px;
          margin: 12vh auto;
          padding: 0 16px;
          color: var(--foreground);
          background: var(--background);
        }
        h1 {
          margin: 0 0 16px;
          font-size: 32px;
          font-weight: 700;
          line-height: 1.35;
        }
        a {
          color: var(--foreground);
        }
      </style>
      <main>
        <h1>${text[lang].reopenTitle}</h1>
        <p>${text[lang].reopen(decksUrl)}</p>
      </main>
    </html>`

/** Headers for every owner-only response. */
export const privateHeaders: Readonly<Record<string, string>> = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
}

/** Why the viewer's frame could not show an owner-only version. */
export type FrameFailure = 'unsupported' | 'expired'

/**
 * What a frame of the viewer gets when its owner-only version cannot be
 * shown: no session reached the request (a browser that keeps no partitioned
 * cookie) or the session ended. It tells the viewer, which then says why in
 * the notice above the slides. It holds nothing of the author's. Only the
 * viewer's own frame is answered so (see frameFailureOf), so a page on
 * another site that frames these slides gets the plain answer.
 */
export const unavailableFrame = (
  publicOrigin: string,
  nonce: string,
  reason: FrameFailure,
) =>
  html`<!doctype html>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex" />
    <script nonce="${nonce}">
      if (parent !== window)
        parent.postMessage(
          { type: 'slide:preview-unavailable', reason: '${reason}' },
          '${publicOrigin}',
        )
    </script>`

/** The policy of that page; only the viewer may frame it. */
export const unavailableFramePolicy = (publicOrigin: string, nonce: string) =>
  `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors ${publicOrigin}`

/**
 * What the frame is answered with once its session is set: a page that moves
 * the frame to the slides by itself. That move is the frame's own, so it is
 * `same-origin`, and the session counts only for requests like it. A redirect
 * would carry the site of whoever started the form, and no move into a frame
 * from another site counts for the session.
 */
export const launchedFrame = (target: string) =>
  html`<!doctype html>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex" />
    <meta http-equiv="refresh" content="0;url=${target}" />`

/** The policy of the page above. */
export const launchedFramePolicy = (publicOrigin: string) =>
  `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${publicOrigin}`
