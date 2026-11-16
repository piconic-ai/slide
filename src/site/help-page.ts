import { html } from 'hono/html'
import { safetyHelp } from '../safety/pages'
import { siteFooter } from './footer'
import { messages, type Lang } from './i18n'
import { SERVICE_NAME } from './service'

/** The help page carries only service markup, so it allows nothing else. */
export const HELP_PAGE_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

export const HELP_PATH = '/help'

const text = messages({
  ja: { title: 'ヘルプ', top: 'トップページへ' },
  en: { title: 'Help', top: 'Go to the top page' },
})

/**
 * What holds for every slide, so that a slide page only has to show what is
 * particular to it.
 */
export const helpPage = (lang: Lang, url: URL) => {
  const t = text[lang]
  return html`<!doctype html>
    <html lang="${lang}">
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${t.title} - ${SERVICE_NAME}</title>
      <style>
        body {
          font: 16px system-ui;
          max-width: 720px;
          margin: 6vh auto;
          padding: 0 16px;
          line-height: 1.7;
          color: #152439;
          background: #f4f6fa;
        }
        h3 {
          margin-bottom: 4px;
        }
        h3 + p {
          margin-top: 0;
        }
      </style>
      <h1>${t.title}</h1>
      ${safetyHelp(lang)}
      <p><a href="/">${t.top}</a></p>
      ${siteFooter(lang, url)}
    </html>`
}
