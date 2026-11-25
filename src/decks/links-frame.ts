import { html } from 'hono/html'
import {
  linkLabelOf,
  MAX_LINKS,
  MAX_TITLE_LENGTH,
  siteNameOf,
  type LinkNotice,
} from '../links/link'
import { kindNames, linkIcon } from '../links/link-parts'
import type { StoredLink } from '../links/store'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    heading: '関連リンク',
    note: `発表の録画やブログの記事など、外のページへのリンクを、スライドの題名の下に載せます。${MAX_LINKS} 件まで、足した順に並びます。`,
    url: 'URL',
    title: '題名',
    titleNote: '未入力の場合は、サイト名(例: zenn.dev)を出します。',
    add: '追加する',
    remove: '外す',
    removeLabel: (title: string) => `『${title}』を外す`,
    notices: {
      kind: '種類は、動画、記事、その他のどれかにしてください。',
      url_invalid:
        'URL を確かめてください。https:// で始まる、1 つの URL を入れます。',
      url_scheme: 'https:// で始まる URL だけ使えます。',
      url_credentials: 'ユーザー名やパスワードを含む URL は使えません。',
      url_too_long: 'URL が長すぎます。2,000 文字までにしてください。',
      title_missing:
        '題名に、見える文字を入れてください。空のままなら、サイト名を出します。',
      title_too_long: `題名は ${MAX_TITLE_LENGTH} 文字までにしてください。`,
      title_invalid: '題名に、改行などの制御文字は使えません。',
      full: `関連リンクは ${MAX_LINKS} 件までです。要らないものを外してから足してください。`,
      duplicate: 'すでに足してあります。',
    } satisfies Record<LinkNotice, string>,
  },
  en: {
    heading: 'Related links',
    note: `Links to a recording, a blog post or another page appear under the title of the slides. Up to ${MAX_LINKS}, in the order you add them.`,
    url: 'URL',
    title: 'Title',
    titleNote: 'If left blank, the site name (e.g. zenn.dev) is shown.',
    add: 'Add',
    remove: 'Remove',
    removeLabel: (title: string) => `Remove "${title}"`,
    notices: {
      kind: 'The kind must be video, article or other.',
      url_invalid: 'Check the URL. Enter one URL that starts with https://.',
      url_scheme: 'Only URLs that start with https:// work.',
      url_credentials: 'A URL with a user name or password cannot be used.',
      url_too_long: 'The URL is too long. Use at most 2,000 characters.',
      title_missing:
        'The title needs a character a reader can see. Leave it empty to show the site name.',
      title_too_long: `Use at most ${MAX_TITLE_LENGTH} characters for the title.`,
      title_invalid:
        'The title cannot contain line breaks or other control characters.',
      full: `Slides can have ${MAX_LINKS} related links. Remove one before you add another.`,
      duplicate: 'This link is already on the slides.',
    },
  },
})

/**
 * Where the editing page of one slide lists its related links, each with a
 * button that removes it, and the form that adds one. A refused add comes
 * back to this page with the reason above the form.
 */
export const linksFrame = (
  view: Readonly<{
    slug: string
    links: readonly StoredLink[]
    notice: LinkNotice | null
  }>,
  lang: Lang,
) => {
  const t = text[lang]
  return html`<section class="panel" data-deck-frame="links" id="links">
    <h2>${t.heading}</h2>
    <p class="field-note">${t.note}</p>
    ${
      view.links.length
        ? html`<ul class="link-rows">
            ${view.links.map(
              (link) =>
                html`<li class="link-row">
                  <span class="link-row-kind"
                    >${linkIcon(link.kind)}${kindNames[lang][link.kind]}</span
                  >
                  <span class="link-row-body">
                    <span class="link-row-title">${linkLabelOf(link)}</span>
                    ${
                      link.title === null
                        ? ''
                        : html`<span class="link-row-site"
                            >${siteNameOf(link.url)}</span
                          >`
                    }
                  </span>
                  <form
                    method="post"
                    action="/slides/${view.slug}/links/${link.id}/delete"
                  >
                    <button
                      class="button-secondary"
                      type="submit"
                      aria-label="${t.removeLabel(linkLabelOf(link))}"
                    >
                      ${t.remove}
                    </button>
                  </form>
                </li>`,
            )}
          </ul>`
        : ''
    }
    ${
      view.notice
        ? html`<p class="notice-danger" role="alert">
            ${t.notices[view.notice]}
          </p>`
        : ''
    }
    <form method="post" action="/slides/${view.slug}/links" class="link-form">
      <div class="field">
        <label for="link-url">${t.url}</label>
        <input
          class="text-input"
          id="link-url"
          name="url"
          type="url"
          required
          placeholder="https://"
          autocomplete="off"
        />
      </div>
      <div class="field">
        <label for="link-title">${t.title}</label>
        <input
          class="text-input"
          id="link-title"
          name="title"
          autocomplete="off"
          aria-describedby="link-title-note"
        />
        <p class="field-note" id="link-title-note">${t.titleNote}</p>
      </div>
      <button class="button-secondary" type="submit">${t.add}</button>
    </form>
  </section>`
}
