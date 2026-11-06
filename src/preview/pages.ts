import { html } from 'hono/html'

export const PREVIEW_COOKIE = '__Host-slide_preview'

/**
 * A page on the management origin that posts the launch token to the
 * deployment's origin, so the token never appears in a URL.
 */
export const launchPage = (action: string, token: string, nonce: string) =>
  html`<!doctype html>
    <html lang="ja">
      <meta charset="utf-8" />
      <meta name="robots" content="noindex" />
      <title>作者限定で開く</title>
      <form method="post" action="${action}">
        <input type="hidden" name="token" value="${token}" />
        <button type="submit">作者限定で開く</button>
      </form>
      <script nonce="${nonce}">
        document.forms[0].submit()
      </script>
    </html>`

/** Shown on the content origin when a launch or session is not usable. */
export const reopenPage = (decksUrl: string) =>
  html`<!doctype html>
    <html lang="ja">
      <meta charset="utf-8" />
      <meta name="robots" content="noindex" />
      <title>開き直してください</title>
      <p>
        作者限定のリンクは期限切れか使用済みです。<a href="${decksUrl}"
          >管理画面</a
        >から開き直してください。
      </p>
    </html>`

/** Headers for every owner-only response. */
export const privateHeaders: Readonly<Record<string, string>> = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
}
