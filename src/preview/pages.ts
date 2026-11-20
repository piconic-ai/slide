import { html } from 'hono/html'
import { designTokensCssRaw } from '../site/design-tokens'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    open: 'viewer で開く',
    reopenTitle: '開き直してください',
    reopen: (dashboard: string) =>
      html`このリンクは期限切れか使用済みです。<a href="${dashboard}"
          >管理画面</a
        >から開き直してください。`,
  },
  en: {
    open: 'Open in viewer',
    reopenTitle: 'Open it again',
    reopen: (dashboard: string) =>
      html`This link has expired or was already used. Open it again from
        <a href="${dashboard}">your dashboard</a>.`,
  },
})

export const PREVIEW_COOKIE = '__Host-slide_preview'

/**
 * A page on the management origin that posts the launch token to the
 * deployment's origin, so the token never appears in a URL.
 */
export const launchPage = (
  action: string,
  token: string,
  nonce: string,
  lang: Lang,
) =>
  html`<!doctype html>
    <html lang="${lang}">
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width" />
      <meta name="robots" content="noindex" />
      <title>${text[lang].open}</title>
      <style nonce="${nonce}">
        ${designTokensCssRaw} body {
          font: 16px/1.8 var(--font-sans);
          max-width: 640px;
          margin: 12vh auto;
          padding: 0 16px;
          color: var(--foreground);
          background: var(--background);
        }
        .button-primary {
          min-height: 40px;
          padding: 10px 20px;
          border: 0;
          border-radius: var(--radius-full);
          background: var(--primary);
          color: var(--primary-foreground);
          font: 600 15px/1.2 var(--font-sans);
        }
      </style>
      <form method="post" action="${action}">
        <input type="hidden" name="token" value="${token}" />
        <button class="button-primary" type="submit">${text[lang].open}</button>
      </form>
      <script nonce="${nonce}">
        document.forms[0].submit()
      </script>
    </html>`

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
