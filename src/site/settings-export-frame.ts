import { html } from 'hono/html'
import { downloadLinks, type DownloadLink } from './download-links'
import { messages, type Lang } from './i18n'

const text = messages({
  ja: { heading: 'データを書き出す' },
  en: { heading: 'Export your data' },
})

/**
 * The place in settings for taking one's data out (02-PAGES 09). It sits in
 * the account part of the page, above leaving the service. Work E decides
 * what is offered, adds the sentence on what it holds and the list of
 * slides. With no links, settings show nothing here.
 */
export const settingsExportFrame = (
  links: readonly DownloadLink[],
  lang: Lang,
) =>
  links.length === 0
    ? ''
    : html`<section class="panel" id="export">
        <h2>${text[lang].heading}</h2>
        ${downloadLinks(links)}
      </section>`
