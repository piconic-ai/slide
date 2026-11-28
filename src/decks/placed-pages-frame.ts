import { html } from 'hono/html'
import type { DeckEvent } from '../events/deck-event'
import { linkPagePath } from '../links/link-address'
import { headingOf } from '../links/link-heading'
import type { ShownLink } from '../links/link-page-store'
import type { StoredLink } from '../links/store'
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

/** A page of links a slide appears on. */
export type PlacedPage = Readonly<{
  href: string
  heading: string
  /** The name of the community the link is in; null for none. */
  community: string | null
}>

/**
 * The heading of a link that is no event, from the link's own title: the
 * page itself is headed by the first title saved, which may be another's.
 */
const headingOfLink = (link: StoredLink): string => {
  const url = new URL(
    `https://${linkPagePath(link.href).slice('/link/'.length)}`,
  )
  return headingOf({
    service: 'web',
    host: url.host,
    url: url.href,
    name: null,
    firstTitle: link.title,
  })
}

/**
 * The pages of links a slide appears on, in the order of its related links,
 * each page once (F29-AC30): of the links whose page shows, at the path the
 * slide is listed on. A link that is no event may be listed on the page of
 * an event with the same address (F45-AC38); two links of one page make one
 * row, headed by the first.
 */
export const placedPagesOf = (
  links: readonly StoredLink[],
  events: readonly DeckEvent[],
  shown: readonly ShownLink[],
): readonly PlacedPage[] => {
  const placed = new Map(shown.map((link) => [link.linkId, link]))
  const pages = new Map<string, PlacedPage>()
  for (const link of links) {
    const shownLink = placed.get(link.id)
    if (shownLink === undefined || pages.has(shownLink.path)) continue
    const href = shownLink.path
    const event =
      link.kind === 'event'
        ? events.find((each) => each.id === link.eventId)
        : null
    if (event === undefined) continue
    pages.set(href, {
      href,
      heading: event ? headingOf(event) : headingOfLink(link),
      community: event ? (event.community?.name ?? null) : shownLink.community,
    })
  }
  return [...pages.values()]
}

/**
 * Where the page of one slide lists, under the related links, the pages the
 * slide appears on (F29-AC30): the related links whose page of links shows,
 * each once, with its community. Nothing is chosen here; with none, one
 * sentence says where they come from.
 */
export const placedPagesFrame = (pages: readonly PlacedPage[], lang: Lang) => {
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
                      <a class="link-row-title" href="${page.href}"
                        >${page.heading}</a
                      >
                      ${
                        page.community
                          ? html`<span class="link-row-site"
                              >${page.community}</span
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
