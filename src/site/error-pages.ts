import { html } from 'hono/html'
import { messages, type Lang } from './i18n'
import { pageShell, PLAIN_PAGE_POLICY } from './shell'

/**
 * The path as an error log may name it. The address that returns an agent a
 * stored file carries its credential in the path, so a log names the route
 * (`/mcp/files/:value`) and never the value. The route catches its own
 * errors; this holds for anything thrown before it is reached.
 */
export const loggedPath = (path: string): string =>
  path.startsWith('/mcp/files/') ? '/mcp/files/:value' : path

/** Error pages carry only service markup and the shared frame. */
export const ERROR_PAGE_POLICY = PLAIN_PAGE_POLICY

export type ErrorKind = 'not_found' | 'server_error'

const statuses: Readonly<Record<ErrorKind, 404 | 500>> = {
  not_found: 404,
  server_error: 500,
}

/** API clients read English, whatever the screen language. */
const apiMessages: Readonly<Record<ErrorKind, string>> = {
  not_found: 'Not found',
  server_error: 'Internal error; retry later',
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
  return pageShell({
    lang,
    title,
    url,
    width: 'narrow',
    body: html`<div class="color-block color-block-ecru error-block">
      <h1>${title}</h1>
      <p>${message}</p>
      <p><a class="button-primary" href="/">${t.top}</a></p>
    </div>`,
  })
}
