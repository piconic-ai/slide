import { html } from 'hono/html'
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
 * Where a new version of the slides is dropped. For now it is the frame
 * alone: the button is disabled, so it is plain that nothing can be chosen
 * yet. Receiving the file belongs to the drop feature, which fills it.
 */
export const replaceFrame = (lang: Lang) => {
  const t = text[lang]
  return html`<section data-deck-frame="replace">
    <h2>${t.heading}</h2>
    <div class="drop-zone" data-drop-zone="replace">
      <p class="drop-title">${t.dropTitle}</p>
      <button type="button" class="button-secondary" disabled>
        ${t.chooseFile}
      </button>
      <p class="drop-note">${t.note}</p>
    </div>
  </section>`
}
