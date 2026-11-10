import { html } from 'hono/html'
import { siteFooter } from './footer'
import { messages, type Lang } from './i18n'
import { SERVICE_NAME } from './service'

/** Error pages carry only service markup, so they allow nothing else. */
export const ERROR_PAGE_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

export type ErrorKind = 'not_found' | 'server_error' | 'maintenance'

const statuses: Readonly<Record<ErrorKind, 404 | 500 | 503>> = {
  not_found: 404,
  server_error: 500,
  maintenance: 503,
}

/** API clients read English, whatever the screen language. */
const apiMessages: Readonly<Record<ErrorKind, string>> = {
  not_found: 'Not found',
  server_error: 'Internal error; retry later',
  maintenance: 'Under maintenance; retry later',
}

type ErrorText = Readonly<{ title: string; message: string }>

const text = messages<{
  pages: Readonly<Record<ErrorKind, ErrorText>>
  top: string
}>({
  ja: {
    pages: {
      not_found: {
        title: 'ページが見つかりません',
        message: 'URL が正しいか確かめてください。',
      },
      server_error: {
        title: 'エラーが発生しました',
        message: '時間をおいて、もう一度お試しください。',
      },
      maintenance: {
        title: 'メンテナンス中です',
        message: 'しばらくしてから、もう一度アクセスしてください。',
      },
    },
    top: 'トップページへ',
  },
  en: {
    pages: {
      not_found: {
        title: 'Page not found',
        message: 'Check that the URL is correct.',
      },
      server_error: {
        title: 'Something went wrong',
        message: 'Please wait a moment and try again.',
      },
      maintenance: {
        title: 'Under maintenance',
        message: 'Please come back in a little while.',
      },
    },
    top: 'Go to the top page',
  },
})

export const errorStatus = (kind: ErrorKind) => statuses[kind]

export const errorJson = (kind: ErrorKind) => ({
  error: apiMessages[kind],
  code: kind,
})

/** `url` is the page that failed; the language switcher reopens it. */
export const errorPage = (kind: ErrorKind, lang: Lang, url: URL) => {
  const t = text[lang]
  const { title, message } = t.pages[kind]
  return html`<!doctype html>
    <html lang="${lang}">
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title} - ${SERVICE_NAME}</title>
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
      <p><a href="/">${t.top}</a></p>
      ${siteFooter(lang, url)}
    </html>`
}

/** Seconds a client is asked to wait during maintenance. */
export const MAINTENANCE_RETRY_AFTER_SECONDS = 300

/** Maintenance is on only for an explicit value, never by accident. */
export const isMaintenance = (value: string | undefined) => value === 'on'
