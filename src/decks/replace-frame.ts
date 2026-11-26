import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { dropZoneBody } from '../site/drop-zone-body'
import { messages, type Lang } from '../site/i18n'
import { frameHelpLink } from '../help/frame-links'

type Markup = HtmlEscapedString | Promise<HtmlEscapedString> | string

const text = messages({
  ja: {
    heading: '新しい版',
    dropTitle: '新しい版をドロップ',
    note: 'HTML、zip に対応。共有 URL は変わりません。記事と関連リンクも残ります。',
  },
  en: {
    heading: 'New version',
    dropTitle: 'Drop a new version',
    note: 'HTML and zip work. The share link stays the same. The article and related links stay too.',
  },
})

/**
 * Where a new version of the slides is dropped. The button starts disabled
 * and /drop.js enables it; the script sends the file as a new version of
 * this slide and opens the page again. What readers see does not change
 * until the author publishes the new version from the row under the drop zone.
 */
export const replaceFrame = (slug: string, versions: Markup, lang: Lang) => {
  const t = text[lang]
  return html`<section class="panel" data-deck-frame="replace">
    <h2>${t.heading}</h2>
    ${frameHelpLink('deck-replace', lang)}
    <div class="drop-zone" data-drop-zone="replace" data-deck="${slug}">
      ${dropZoneBody(lang, { title: t.dropTitle, note: t.note })}
    </div>
    ${versions}
  </section>`
}
