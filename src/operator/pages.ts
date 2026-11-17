import { html } from 'hono/html'
import type { Operator } from './access'

/** No script, no image, and no framing: the pages are plain forms. */
export const OPERATOR_PAGE_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"

/** The operator's first page. */
export const operatorHome = (operator: Operator) =>
  html`<!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>運営 - slide</title>
      </head>
      <body>
        <h1>運営</h1>
        <p>${operator.email} として操作しています。</p>
      </body>
    </html>`
