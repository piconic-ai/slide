import { html } from 'hono/html'
import { embedCodeOf } from '../embed/code'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    heading: '埋め込みコード',
    copy: 'コピー',
    copied: 'コピーしました',
    notPublic: '公開すると、このスライドをブログなどに埋め込めます。',
  },
  en: {
    heading: 'Embed code',
    copy: 'Copy',
    copied: 'Copied',
    notPublic: 'Once published, the slides can be embedded in a blog post.',
  },
})

/**
 * The code that embeds the slides in another site, with the button that
 * copies it: the same code the viewer's share menu copies. Only public
 * slides can be embedded, so before that one line says the code comes with
 * publishing. `shareUrl` is missing while no content origin is set, or
 * before a handle exists; nothing can be embedded then either.
 */
export const embedCodeFrame = (
  view: Readonly<{
    shareUrl: string | null
    /** The title of the public version, or the URL name. */
    name: string
    isPublic: boolean
  }>,
  lang: Lang,
) => {
  const t = text[lang]
  return html`<section class="panel" data-deck-frame="embed-code">
    <h2 id="embed-code-heading">${t.heading}</h2>
    ${
      view.shareUrl && view.isPublic
        ? html`<div class="copy-row">
            <input
              class="text-input"
              id="embed-code"
              aria-labelledby="embed-code-heading"
              readonly
              value="${embedCodeOf(view.shareUrl, view.name)}"
            />
            <button
              class="button-secondary"
              type="button"
              data-copy="embed-code"
              data-copied="${t.copied}"
            >
              ${t.copy}
            </button>
          </div>`
        : html`<p class="field-note">${t.notPublic}</p>`
    }
  </section>`
}
