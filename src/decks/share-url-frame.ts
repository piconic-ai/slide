import { html } from 'hono/html'
import { copyRow } from '../site/copy-row'
import { messages, type Lang } from '../site/i18n'
import { prefixedField } from '../site/prefixed-field'
import type { SlugNotice } from './slug-name'

const text = messages({
  ja: {
    shareUrl: '共有 URL',
    notPublic: '公開すると、この URL で読めます。',
    urlName: 'URL',
    change: '変更する',
    renamableNote:
      'この部分だけ変えられます。公開する前だけ、英小文字、数字、ハイフンで、64 文字まで。',
    fixedNote: '公開したあとは変えられません。',
    notices: {
      renamed: 'URL の名前を変えました。',
      invalid:
        'その名前は使えません。英小文字、数字、ハイフンで、64 文字までにしてください。先頭と末尾は、英小文字か数字にします。',
      reserved: 'その名前は、サービスが使っているので選べません。',
      taken: '同じ名前のスライドが、もうあります。',
      published: '公開したスライドの URL の名前は変えられません。',
    } satisfies Record<SlugNotice, string>,
  },
  en: {
    shareUrl: 'Share link',
    notPublic: 'Once published, the slides can be read at this link.',
    urlName: 'URL',
    change: 'Change',
    renamableNote:
      'Only this part can be changed, and only before you publish. Lowercase letters, digits and hyphens, up to 64 characters.',
    fixedNote: 'It cannot be changed once the slides were published.',
    notices: {
      renamed: 'The name in the URL was changed.',
      invalid:
        'That name cannot be used. Use lowercase letters, digits and hyphens, up to 64 characters, starting and ending with a letter or a digit.',
      reserved: 'That name is used by the service and cannot be chosen.',
      taken: 'You already have slides of that name.',
      published: 'The name in the URL of published slides cannot be changed.',
    },
  },
})

/** The name a slide's URL may end in, as the input's own check. */
const SLUG_PATTERN = '[a-z0-9]([a-z0-9\\-]{0,62}[a-z0-9])?'

/**
 * What the share URL says before the slide's own name: `host/@handle/`.
 * Null when there is no share URL, or it does not end in the name.
 */
export function urlPrefixOf(shareUrl: string | null, slug: string) {
  if (!shareUrl) return null
  const url = new URL(shareUrl)
  return url.pathname.endsWith(`/${slug}`)
    ? `${url.host}${url.pathname.slice(0, -slug.length)}`
    : null
}

/**
 * The share URL of one of the author's slides, with the name it ends in.
 * The URL is there before the slides are public, so the author can see what
 * they will hand out. The name is shown as the end of the URL itself: while
 * nobody was ever given the URL, only that part is an input and it can be
 * changed here; once the slides were published it is only shown.
 */
export const shareUrlFrame = (
  view: Readonly<{
    slug: string
    /** Missing while no content origin is set, or before a handle exists. */
    shareUrl: string | null
    isPublic: boolean
    /** Whether the URL name may still be changed: never published. */
    renamable: boolean
    /** What the last change of the name came to, if this page follows one. */
    notice: SlugNotice | null
  }>,
  lang: Lang,
) => {
  const t = text[lang]
  const prefix = urlPrefixOf(view.shareUrl, view.slug)
  return html`<section class="panel" data-deck-frame="share-url">
    ${
      view.shareUrl
        ? html`<label for="share-url">${t.shareUrl}</label>
            ${copyRow({ id: 'share-url', value: view.shareUrl }, lang)}
            ${view.isPublic ? '' : html`<p class="field-note">${t.notPublic}</p>`}`
        : ''
    }
    ${
      view.notice
        ? html`<p
            class="${view.notice === 'renamed' ? 'notice-success' : 'notice-danger'}"
            role="${view.notice === 'renamed' ? 'status' : 'alert'}"
          >
            ${t.notices[view.notice]}
          </p>`
        : ''
    }
    ${
      view.renamable
        ? html`<form
            method="post"
            action="/slides/${view.slug}/slug"
            data-url-name-form
          >
            <div class="field">
              <label for="url-name">${t.urlName}</label>
              ${nameField(
                prefix,
                html`<input
                  id="url-name"
                  name="slug"
                  required
                  maxlength="64"
                  pattern="${SLUG_PATTERN}"
                  autocapitalize="none"
                  autocomplete="off"
                  spellcheck="false"
                  aria-describedby="url-name-note"
                  value="${view.slug}"
                />`,
              )}
              <p class="field-note" id="url-name-note">${t.renamableNote}</p>
            </div>
            <button class="button-secondary">${t.change}</button>
          </form>`
        : html`<div class="field">
            <span class="field-label" id="url-name-label">${t.urlName}</span>
            <p
              class="prefixed-text"
              id="url-name"
              aria-labelledby="url-name-label"
            >
              ${prefix ? html`<span>${prefix}</span>` : ''}<strong
                >${view.slug}</strong
              >
            </p>
            <p class="field-note">${t.fixedNote}</p>
          </div>`
    }
  </section>`
}

/** The input of the name, after the start of the URL when that is known. */
const nameField = (prefix: string | null, control: ReturnType<typeof html>) =>
  prefix === null
    ? html`<div class="prefixed-field">${control}</div>`
    : prefixedField(prefix, control)
