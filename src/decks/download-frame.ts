import { html } from 'hono/html'
import { messages, type Lang } from '../site/i18n'
import { downloadLinks, type DownloadLink } from '../site/download-links'

const text = messages({
  ja: {
    heading: 'ダウンロード',
    note: '置いたままのファイルを zip で受け取れます。そのまま置き直すと、同じスライドになります。',
  },
  en: {
    heading: 'Download',
    note: 'Take the files as you put them, in a zip. Put them up again as they are and you get the same slides.',
  },
})

/**
 * The place on one slide's page for downloading it (02-PAGES 08): the
 * published version, the prepared one, the article and the slide's
 * information. Work E decides which links there are and builds them. With
 * none, the page shows nothing here.
 */
export const downloadFrame = (links: readonly DownloadLink[], lang: Lang) =>
  links.length === 0
    ? ''
    : html`<section class="panel" data-deck-frame="downloads">
        <h2>${text[lang].heading}</h2>
        <p>${text[lang].note}</p>
        ${downloadLinks(links)}
      </section>`
