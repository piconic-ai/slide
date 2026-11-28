import { html } from 'hono/html'
import type { DeckEvent } from '../events/deck-event'
import { linkPagePath } from '../links/link-address'
import { headingOf } from '../links/link-heading'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: {
    heading: 'このスライドが並ぶページ',
    none: '並ぶページは、関連リンクから決まります。いまは、並ぶページがありません。',
    note: '関連リンクから決まるので、ここでは選べません。ページから外すときは、関連リンクを外してください。',
  },
  en: {
    heading: 'Pages this slide appears on',
    none: 'The related links decide the pages. For now it appears on none.',
    note: 'They come from the related links, so they are not chosen here. To leave a page, remove its related link.',
  },
})

/**
 * Where the page of one slide lists, under the related links, the pages the
 * slide appears on (F29-AC30): the related links whose page of links shows,
 * each once, with its community. Nothing is chosen here; with none, one
 * sentence says where they come from.
 */
export const placedPagesFrame = (pages: readonly DeckEvent[], lang: Lang) => {
  const t = text[lang]
  return html`<section
    class="panel"
    data-deck-frame="placed-pages"
    id="placed-pages"
  >
    <h2>${t.heading}</h2>
    ${
      pages.length === 0
        ? html`<p class="field-note">${t.none}</p>`
        : html`<ul class="link-rows">
              ${pages.map(
                (page) =>
                  html`<li class="link-row">
                    <span class="link-row-body">
                      <a class="link-row-title" href="${linkPagePath(page.url)}"
                        >${headingOf(page)}</a
                      >
                      ${
                        page.community
                          ? html`<span class="link-row-site"
                              >${page.community.name}</span
                            >`
                          : ''
                      }
                    </span>
                  </li>`,
              )}
            </ul>
            <p class="field-note">${t.note}</p>`
    }
  </section>`
}
