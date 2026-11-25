import { html } from 'hono/html'
import { linkLabelOf, siteNameOf } from '../links/link'
import { kindNames, linkIcon } from '../links/link-parts'
import type { StoredLink } from '../links/store'
import { messages, type Lang } from '../site/i18n'

const text = messages({
  ja: { heading: '関連リンク' },
  en: { heading: 'Related links' },
})

/**
 * Where the viewer shows a deck's related links (video, article, other),
 * under the description and above the article: one round link each, in the
 * order they were added, wrapping onto more lines. With none it holds
 * nothing at all, heading and white space included. Each link is `rel="noopener
 * nofollow ugc"` and opens in the same tab; it sends no `noreferrer`, so the
 * page it leaves is known to the target as for any other link.
 */
export const viewerLinksFrame = (links: readonly StoredLink[], lang: Lang) =>
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
                  href="${link.url}"
                  rel="noopener nofollow ugc"
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
                          >${siteNameOf(link.url)}</span
                        >`
                  }</a
                >
              </li>`,
          )}
        </ul>
      </section>`
