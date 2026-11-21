import { html } from 'hono/html'
import { messages, type Lang } from './i18n'

const text = messages({
  ja: { copy: 'コピー', copied: 'コピーしました' },
  en: { copy: 'Copy', copied: 'Copied' },
})

/**
 * The face of a copy button: its words and the words it says once it has
 * copied, stacked in one grid cell so the button is as wide and as tall as
 * the longer of the two. `share.js` shows one of them at a time, so saying
 * "copied" never moves the button, its row or the menu around it.
 */
export const copyLabel = (idle: string, copied: string) =>
  html`<span class="copy-label"
    ><span class="copy-idle">${idle}</span
    ><span class="copy-done">${copied}</span></span
  >`

/**
 * A read-only field with the button that copies it. `share.js` copies the
 * field whose `id` the button's `data-copy` names, and says the button's
 * `data-copied` text once it has.
 */
export const copyRow = (
  field: Readonly<{
    id: string
    value: string
    /** The heading that names the field, when no `<label>` does. */
    labelledBy?: string
  }>,
  lang: Lang,
) => {
  const t = text[lang]
  const labelled = field.labelledBy
    ? html` aria-labelledby="${field.labelledBy}"`
    : ''
  return html`<div class="copy-row">
    <input
      class="text-input"
      id="${field.id}"
      ${labelled}
      readonly
      value="${field.value}"
    />
    <button
      class="button-secondary"
      type="button"
      data-copy="${field.id}"
      data-copied="${t.copied}"
    >
      ${copyLabel(t.copy, t.copied)}
    </button>
  </div>`
}
