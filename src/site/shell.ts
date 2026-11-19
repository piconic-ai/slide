import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { AVATAR_ORIGIN } from '../profile/github-profile'
import { siteFooter } from './footer'
import { siteHeader } from './header'
import type { Lang } from './i18n'
import { pageStyle } from './page-style'
import { SERVICE_NAME } from './service'

type Html = HtmlEscapedString | Promise<HtmlEscapedString>

/**
 * What the shared header needs from a page's policy: its script, the request
 * that asks who is signed in, and the author's picture, which GitHub serves.
 */
export const SHELL_SOURCES = `script-src 'self'; connect-src 'self'; img-src ${AVATAR_ORIGIN}`

/** A page of service markup only: the shared frame and nothing else. */
export const PLAIN_PAGE_POLICY = `default-src 'none'; ${SHELL_SOURCES}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`

/** How wide a page's main column is; see DESIGN.md, "幅". */
export type PageWidth = 'wide' | 'reading' | 'narrow'

/**
 * The frame of every service page: the shared header, one `main` holding
 * the page's own markup, and the shared footer. `url` is the page itself,
 * which the footer's language switcher reopens.
 */
export const pageShell = (
  page: Readonly<{
    lang: Lang
    title: string
    url: URL
    body: Html | string
    /** Extra elements for the head: link previews, a page's own styles. */
    head?: Html | string
    width?: PageWidth
    /** A class for the page's own styles to hang on, beside the width. */
    mainClass?: string
    /**
     * 'none' leaves the header's account area out, for a page shown to
     * someone whose session does not answer: a suspended owner.
     */
    account?: 'shown' | 'none'
    /** Left out, the title is followed by the service's name. */
    bareTitle?: boolean
  }>,
) => {
  const title = page.bareTitle ? page.title : `${page.title} - ${SERVICE_NAME}`
  const width = `page-${page.width ?? 'wide'}`
  const mainClass = page.mainClass ? `${width} ${page.mainClass}` : width
  return html`<!doctype html>
    <html lang="${page.lang}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        ${pageStyle} ${page.head ?? ''}
        <script src="/share.js" defer></script>
      </head>
      <body>
        ${siteHeader(page.lang, page.account)}
        <main class="${mainClass}">${page.body}</main>
        ${siteFooter(page.lang, page.url)}
      </body>
    </html>`
}
