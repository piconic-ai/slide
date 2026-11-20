import { html } from 'hono/html'
import { DROP_ACCEPT } from '../drops/accept'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    heading: '差し替え',
    dropTitle: '新しい版をドロップ',
    chooseFile: 'ファイルを選ぶ',
    note: '共有 URL は変わりません。',
  },
  en: {
    heading: 'Replace',
    dropTitle: 'Drop a new version',
    chooseFile: 'Choose a file',
    note: 'The share link stays the same.',
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
  return html`<section data-deck-frame="replace">
    <h2>${t.heading}</h2>
    <div class="drop-zone" data-drop-zone="replace" data-deck="${slug}">
      <p class="drop-title" data-drop-title>${t.dropTitle}</p>
      <button type="button" class="button-secondary" data-drop-choose disabled>
        ${t.chooseFile}
      </button>
      <input
        type="file"
        data-drop-input
        accept="${DROP_ACCEPT}"
        aria-label="${t.chooseFile}"
        hidden
      />
      <p class="drop-note" data-drop-note>${t.note}</p>
      <script type="module" src="/drop.js"></script>
    </div>
  </section>`
}
