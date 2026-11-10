import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    open: '作者限定で開く',
    reopenTitle: '開き直してください',
    reopen: (dashboard: string) =>
      html`作者限定のリンクは期限切れか使用済みです。<a href="${dashboard}"
          >管理画面</a
        >から開き直してください。`,
  },
  en: {
    open: 'Open as author',
    reopenTitle: 'Open it again',
    reopen: (dashboard: string) =>
      html`This author-only link has expired or was already used. Open it again
        from <a href="${dashboard}">your dashboard</a>.`,
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
      <meta name="robots" content="noindex" />
      <title>${text[lang].open}</title>
      <form method="post" action="${action}">
        <input type="hidden" name="token" value="${token}" />
        <button type="submit">${text[lang].open}</button>
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
      <meta name="robots" content="noindex" />
      <title>${text[lang].reopenTitle}</title>
      <p>${text[lang].reopen(decksUrl)}</p>
    </html>`

/** Headers for every owner-only response. */
export const privateHeaders: Readonly<Record<string, string>> = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
}
