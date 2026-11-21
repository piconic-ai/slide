import { html } from 'hono/html'
import { DROP_ACCEPT } from '../drops/accept'
import { messages, type Lang } from './i18n'

const text = messages({
  ja: { chooseFile: 'ファイルを選ぶ' },
  en: { chooseFile: 'Choose a file' },
})

/**
 * What /drop.js drives inside an element marked `data-drop-zone`: the
 * title, the button that opens the file picker (disabled until the script
 * runs), the hidden file input and the note. The caller owns the zone
 * element, and with it the zone's kind and what the script does with a file.
 */
export const dropZoneBody = (
  lang: Lang,
  words: Readonly<{ title: string; note: string }>,
) => {
  const t = text[lang]
  return html`<p class="drop-title" data-drop-title>${words.title}</p>
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
    <p class="drop-note" data-drop-note>${words.note}</p>
    <script type="module" src="/drop.js"></script>`
}
