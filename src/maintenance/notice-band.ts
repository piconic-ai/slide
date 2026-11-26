import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { messages, type Lang } from '../site/i18n'
import { formatJst } from './maintenance-text'
import type { MaintenanceNotice } from './notice'
import { formatUntil } from './switch'

type Html = HtmlEscapedString | Promise<HtmlEscapedString>

/**
 * What marks the header of a page, which the band goes in front of. Every
 * service page draws its header with `siteHeader` (`src/site/header.ts`), and
 * the top page is built from the same markup, so this is found once on each.
 */
export const HEADER_MARKER = '<header class="site-header">'

const text = messages({
  ja: {
    sentence: (start: Html, end: Html) =>
      html`${start}から${end}まで(日本時間)、メンテナンスのためサービスを止めます。`,
    help: '詳しくはヘルプへ',
  },
  en: {
    sentence: (start: Html, end: Html) =>
      html`We will stop the service for maintenance from ${start} to ${end}.`,
    help: 'Details in the Help',
  },
})

/**
 * The band is one line over the header, as wide as the page, in a color block
 * of the design (DESIGN.md). It sets its own style because it is put in front
 * of pages of every kind, the top page among them. The link is at least 44px
 * tall to press, and there is no button to close it (F38-AC3).
 */
const style = html`<style>
  .maintenance-band {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    column-gap: 16px;
    padding: 4px 16px;
    background: var(--block-yellow);
    color: var(--foreground);
    font-size: 14px;
    line-height: 1.6;
  }
  .maintenance-band p {
    margin: 0;
  }
  .maintenance-band a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--foreground);
  }
</style>`

/**
 * The band over the header (02-PAGES 13): the start and the end in Japan time,
 * in the language of the screen, and a link to the help (F38-AC2, AC3, AC27,
 * AC28). `helpPath` is where the help article on maintenance is. The band is
 * a `status`, so that a screen reader says it once the page opens.
 */
export const maintenanceBand = (
  notice: MaintenanceNotice,
  lang: Lang,
  helpPath: string,
) => {
  const t = text[lang]
  const moment = (seconds: number) =>
    html`<time datetime="${formatUntil(seconds)}"
      >${formatJst(seconds, lang)}</time
    >`
  return html`${style}
    <div class="maintenance-band" role="status">
      <p>${t.sentence(moment(notice.startsAt), moment(notice.endsAt))}</p>
      <a href="${helpPath}">${t.help}</a>
    </div>`
}
