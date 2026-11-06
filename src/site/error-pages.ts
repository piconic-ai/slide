import { html, raw } from 'hono/html'
import { siteFooter } from './legal-pages'

/** Error pages carry only service markup, so they allow nothing else. */
export const ERROR_PAGE_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

export type ErrorKind = 'not_found' | 'server_error' | 'maintenance'

const content: Readonly<
  Record<
    ErrorKind,
    { status: 404 | 500 | 503; title: string; message: string; api: string }
  >
> = {
  not_found: {
    status: 404,
    title: 'ページが見つかりません',
    message: 'URL が正しいか確かめてください。',
    api: 'Not found',
  },
  server_error: {
    status: 500,
    title: 'エラーが発生しました',
    message: '時間をおいて、もう一度お試しください。',
    api: 'Internal error; retry later',
  },
  maintenance: {
    status: 503,
    title: 'メンテナンス中です',
    message: 'しばらくしてから、もう一度アクセスしてください。',
    api: 'Under maintenance; retry later',
  },
}

export const errorStatus = (kind: ErrorKind) => content[kind].status

export const errorJson = (kind: ErrorKind) => ({
  error: content[kind].api,
  code: kind,
})

export const errorPage = (kind: ErrorKind) => {
  const { title, message } = content[kind]
  return html`<!doctype html>
    <html lang="ja">
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title} - slide</title>
      <style>
        body {
          font: 16px system-ui;
          max-width: 640px;
          margin: 12vh auto;
          padding: 0 16px;
          color: #152439;
          background: #f4f6fa;
        }
      </style>
      <h1>${title}</h1>
      <p>${message}</p>
      <p><a href="/">トップページへ</a></p>
      ${raw(siteFooter)}
    </html>`
}

/** Seconds a client is asked to wait during maintenance. */
export const MAINTENANCE_RETRY_AFTER_SECONDS = 300

/** Maintenance is on only for an explicit value, never by accident. */
export const isMaintenance = (value: string | undefined) => value === 'on'
