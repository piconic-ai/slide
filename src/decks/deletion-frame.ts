import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    heading: 'スライドを削除',
    note: '公開中の URL は、すぐに読めなくなります。置いたすべての版のファイルと記録は、24 時間ほど後に消えます。元には戻せません。',
    confirm: (deck: ReturnType<typeof html>) =>
      html`確認のため、URL の末尾(${deck})を入力してください`,
    delete: 'スライドを削除',
  },
  en: {
    heading: 'Delete these slides',
    note: 'Their public URL stops working at once. The files and records of every version are erased about 24 hours later. This cannot be undone.',
    confirm: (deck: ReturnType<typeof html>) =>
      html`To confirm, type the end of the URL (${deck})`,
    delete: 'Delete slides',
  },
})

/**
 * Deleting one of the author's slides. It is laid out top to bottom: what
 * happens, a labelled field to type the end of the URL into, then the button. No
 * field sits in the middle of a sentence.
 */
export const deletionFrame = (deck: string, lang: Lang) => {
  const t = text[lang]
  return html`<section class="panel" data-deck-frame="delete">
    <h2>${t.heading}</h2>
    <p>${t.note}</p>
    <form method="post" action="/slides/${deck}/delete">
      <div class="field">
        <label for="delete-confirm"
          >${t.confirm(html`<code>${deck}</code>`)}</label
        >
        <input
          class="text-input"
          id="delete-confirm"
          name="confirm"
          autocomplete="off"
          required
        />
      </div>
      <button class="button-danger" type="submit">${t.delete}</button>
    </form>
  </section>`
}
