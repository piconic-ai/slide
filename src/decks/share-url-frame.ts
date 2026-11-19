import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    shareUrl: '共有 URL',
    copy: 'コピー',
    copied: 'コピーしました',
    open: '開く',
    notPublic: '公開すると、この URL で読めます。',
    urlName: 'URL の名前',
  },
  en: {
    shareUrl: 'Share link',
    copy: 'Copy',
    copied: 'Copied',
    open: 'Open',
    notPublic: 'Once published, the slides can be read at this link.',
    urlName: 'Name in the URL',
  },
})

/**
 * The share URL of one of the author's slides, with the name it ends in.
 * The URL is there before the slides are public, so the author can see what
 * they will hand out. Changing the name before the first publication is
 * added by the drop feature; here the name is only shown.
 */
export const shareUrlFrame = (
  view: Readonly<{
    slug: string
    /** Missing while no content origin is set, or before a handle exists. */
    shareUrl: string | null
    isPublic: boolean
  }>,
  lang: Lang,
) => {
  const t = text[lang]
  return html`<section class="panel" data-deck-frame="share-url">
    ${
      view.shareUrl
        ? html`<label for="share-url">${t.shareUrl}</label>
            <div class="copy-row">
              <input
                class="text-input"
                id="share-url"
                readonly
                value="${view.shareUrl}"
              />
              <button
                class="button-secondary"
                type="button"
                data-copy="share-url"
                data-copied="${t.copied}"
              >
                ${t.copy}
              </button>
            </div>
            <p class="field-note">
              ${
                view.isPublic
                  ? html`<a href="${view.shareUrl}">${t.open}</a>`
                  : t.notPublic
              }
            </p>`
        : ''
    }
    <label for="url-name">${t.urlName}</label>
    <input class="text-input" id="url-name" readonly value="${view.slug}" />
  </section>`
}
