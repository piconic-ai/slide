import { html } from 'hono/html'
import {
  LINK_KINDS,
  linkLabelOf,
  MAX_LINKS,
  MAX_TITLE_LENGTH,
  siteNameOf,
  type LinkNotice,
} from '../links/link'
import { kindNames, linkIcon } from '../links/link-parts'
import type { StoredLink } from '../links/store'
import { messages, type Lang } from '../site/i18n'
import type { EventCommunity } from '../events/deck-event'

const text = messages({
  ja: {
    heading: '関連リンク',
    note: `発表の録画やブログの記事など、外のページへのリンクを、スライドの題名の下に載せます。${MAX_LINKS} 件まで、足した順に並びます。`,
    url: 'URL',
    kind: '種類',
    kindFromUrl: 'URL から決める',
    kindLabel: (title: string) => `『${title}』の種類`,
    saveKinds: '保存する',
    placedIn: (community: string | null) =>
      community === null
        ? 'イベントとして並びます。'
        : `${community} のイベントとして並びます。`,
    title: '題名',
    titleNote: '未入力の場合は、サイト名(例: zenn.dev)を出します。',
    add: '追加する',
    remove: '外す',
    removeLabel: (title: string) => `『${title}』を外す`,
    notices: {
      kind: '種類は、動画、記事、イベント、その他のどれかにしてください。',
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
    kind: 'Kind',
    kindFromUrl: 'From the URL',
    kindLabel: (title: string) => `Kind of "${title}"`,
    saveKinds: 'Save',
    placedIn: (community: string | null) =>
      community === null
        ? 'Listed as a talk of the event.'
        : `Listed as a talk of an event of ${community}.`,
    title: 'Title',
    titleNote: 'If left blank, the site name (e.g. zenn.dev) is shown.',
    add: 'Add',
    remove: 'Remove',
    removeLabel: (title: string) => `Remove "${title}"`,
    notices: {
      kind: 'The kind must be video, article, event or other.',
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

/** The choice of a kind; the one given is chosen. */
const kindOptions = (lang: Lang, chosen: string) =>
  LINK_KINDS.map(
    (kind) =>
      html`<option value="${kind}" ${chosen === kind ? 'selected' : ''}>
        ${kindNames[lang][kind]}
      </option>`,
  )

/** Under a link of the kind event, where it is listed. */
const placeOf = (
  link: StoredLink,
  communities: ReadonlyMap<number, EventCommunity | null>,
  lang: Lang,
) =>
  link.kind === 'event'
    ? html`<span class="link-row-place"
        >${text[lang].placedIn(communities.get(link.eventId)?.name ?? null)}</span
      >`
    : ''

/**
 * Where the editing page of one slide lists its related links, and the form
 * that adds one. The list is one form: each link has its kind to choose
 * again, saved with one button, and a button that removes it alone. A
 * refused add comes back to this page with the reason above the form.
 */
export const linksFrame = (
  view: Readonly<{
    slug: string
    links: readonly StoredLink[]
    /** The community of each event the links are in; null for none. */
    communities?: ReadonlyMap<number, EventCommunity | null>
    notice: LinkNotice | null
  }>,
  lang: Lang,
) => {
  const t = text[lang]
  const communities = view.communities ?? new Map()
  return html`<section class="panel" data-deck-frame="links" id="links">
    <h2>${t.heading}</h2>
    <p class="field-note">${t.note}</p>
    ${
      view.links.length
        ? html`<form
            method="post"
            action="/my/slides/${view.slug}/links/kinds"
            class="link-kinds"
          >
            <ul class="link-rows">
              ${view.links.map(
                (link) =>
                  html`<li class="link-row">
                    <span class="link-row-kind">
                      ${linkIcon(link.kind)}
                      <select
                        name="kind-${link.id}"
                        aria-label="${t.kindLabel(linkLabelOf(link))}"
                      >
                        ${kindOptions(lang, link.kind)}
                      </select>
                    </span>
                    <span class="link-row-body">
                      <span class="link-row-title">${linkLabelOf(link)}</span>
                      ${
                        link.title === null
                          ? ''
                          : html`<span class="link-row-site"
                              >${siteNameOf(link.href)}</span
                            >`
                      }
                      ${placeOf(link, communities, lang)}
                    </span>
                    <button
                      class="button-secondary"
                      type="submit"
                      formaction="/my/slides/${view.slug}/links/${link.id}/delete"
                      aria-label="${t.removeLabel(linkLabelOf(link))}"
                    >
                      ${t.remove}
                    </button>
                  </li>`,
              )}
            </ul>
            <button class="button-secondary" type="submit">
              ${t.saveKinds}
            </button>
          </form>`
        : ''
    }
    ${
      view.notice
        ? html`<p class="notice-danger" role="alert">
            ${t.notices[view.notice]}
          </p>`
        : ''
    }
    <form
      method="post"
      action="/my/slides/${view.slug}/links"
      class="link-form"
    >
      <div class="field">
        <label for="link-kind">${t.kind}</label>
        <select id="link-kind" name="kind">
          <option value="" selected>${t.kindFromUrl}</option>
          ${kindOptions(lang, '')}
        </select>
      </div>
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
