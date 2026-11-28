import { html } from 'hono/html'
import { linkLabelOf, siteNameOf } from '../links/link'
import { kindNames, linkIcon } from '../links/link-parts'
import { linkCheckTrigger } from './link-check'
import { messages, type Lang } from '../site/i18n'
import type { ViewerLink } from './viewer-parts-store'

const text = messages({
  ja: { heading: '関連リンク', page: 'このリンクを添えたスライド' },
  en: { heading: 'Related links', page: 'Slides with this link' },
})

/**
 * Where the viewer shows a deck's related links (video, article, other),
 * under the description and above the article: one round link each, in the
 * order they were added, wrapping onto more lines. With none it holds
 * nothing at all, heading and white space included. Each link is `rel="noopener
 * nofollow ugc"` and opens in the same tab; it sends no `noreferrer`, so the
 * page it leaves is known to the target as for any other link. With scripts,
 * pressing one first shows the whole address it leads to (`link-check.ts`).
 * A link whose page of links shows has, beside it, a second link to that
 * page on this site (F45-AC18); the others have none.
 */
export const viewerLinksFrame = (links: readonly ViewerLink[], lang: Lang) =>
  links.length === 0
    ? ''
    : html`<section class="related-links" data-viewer-frame="links">
        <h2 id="related-links">${text[lang].heading}</h2>
        <ul aria-labelledby="related-links">
          ${links.map(
            (link) =>
              html`<li>
                <a
                  class="related-link"
                  href="${link.href}"
                  rel="noopener nofollow ugc"
                  ${linkCheckTrigger()}
                  title="${linkLabelOf(link)}"
                  >${linkIcon(link.kind)}
                  <span class="related-link-kind"
                    >${kindNames[lang][link.kind]}</span
                  >
                  <span class="related-link-title">${linkLabelOf(link)}</span>
                  ${
                    link.title === null
                      ? ''
                      : html`<span class="related-link-site"
                          >${siteNameOf(link.href)}</span
                        >`
                  }</a
                >
                ${
                  link.pagePath
                    ? html`<a class="related-link-page" href="${link.pagePath}"
                        >${text[lang].page}</a
                      >`
                    : ''
                }
              </li>`,
          )}
        </ul>
      </section>`
