import { html } from 'hono/html'

/**
 * One thing a person can take with them: what it is, said in their language
 * and with its file type in parentheses ("Published version (zip)"), and
 * where it comes from. The work that fills a download place builds these.
 */
export type DownloadLink = Readonly<{ label: string; href: string }>

/**
 * The links as one list, each a download link rather than a button. Nothing
 * is drawn for no links, so a place with nothing to give stays empty.
 */
export const downloadLinks = (links: readonly DownloadLink[]) =>
  links.length === 0
    ? ''
    : html`<ul class="download-links" role="list">
        ${links.map(
          (link) =>
            html`<li><a href="${link.href}" download>${link.label}</a></li>`,
        )}
      </ul>`
