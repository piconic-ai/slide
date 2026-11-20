import { html } from 'hono/html'
import { messages, type Lang } from './i18n'

const text = messages({
  ja: { copy: 'コピー', copied: 'コピーしました' },
  en: { copy: 'Copy', copied: 'Copied' },
})

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
      ${t.copy}
    </button>
  </div>`
}
