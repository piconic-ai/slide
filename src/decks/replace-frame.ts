import { html } from 'hono/html'
import { dropZoneBody } from '../site/drop-zone-body'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    heading: '新しい版',
    dropTitle: '新しい版をドロップ',
    note: 'HTML、zip に対応。共有 URL は変わりません。',
  },
  en: {
    heading: 'New version',
    dropTitle: 'Drop a new version',
    note: 'HTML and zip work. The share link stays the same.',
  },
})

/**
 * Where a new version of the slides is dropped. The button starts disabled
 * and /drop.js enables it; the script sends the file as a new version of
 * this slide and opens the page again. What readers see does not change
 * until the author publishes the new version from the history.
 */
export const replaceFrame = (slug: string, lang: Lang) => {
  const t = text[lang]
  return html`<section class="panel" data-deck-frame="replace">
    <h2>${t.heading}</h2>
    <div class="drop-zone" data-drop-zone="replace" data-deck="${slug}">
      ${dropZoneBody(lang, { title: t.dropTitle, note: t.note })}
    </div>
  </section>`
}
