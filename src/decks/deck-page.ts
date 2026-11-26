import { html } from 'hono/html'
import {
  panelText,
  publicationPanel,
  viewerLink,
  type PanelView,
} from '../publication/panel'
import { messages, type Lang } from '../site/i18n'
import type { Handle } from '../share/handle'
import { ownerViewerPath } from '../share/path'
import type { DeckSlug } from './deck-id'
import { articleFrame, type ArticleSummary } from './article-frame'
import { linksFrame } from './links-frame'
import { presentedEventsFrame } from './events-frame'
import type { LinkNotice } from '../links/link'
import type { StoredLink } from '../links/store'
import { communitiesOf, type DeckEvent } from '../events/deck-event'
import { deletionFrame } from './deletion-frame'
import { downloadFrame } from './download-frame'
import type { DownloadLink } from '../site/download-links'
import { versionsList } from './versions-frame'
import { replaceFrame } from './replace-frame'
import { shareUrlFrame } from './share-url-frame'
import type { SlugNotice } from './slug-name'

const text = messages({
  ja: { back: '‹ スライドの管理', title: 'スライドの編集' },
  en: { back: '‹ Your slides', title: 'Edit slide' },
})

/** The page title of the editing page of one slide, for renderPage. */
export const deckPageTitle = (lang: Lang) => text[lang].title

/** What the page of one of the author's slides shows. */
export type DeckPageView = Readonly<{
  slug: DeckSlug
  /** The author's handle; without one there is no viewer to open. */
  handle: Handle | null
  /** The title of the version shown, or the URL name before it has one. */
  name: string
  shareUrl: string | null
  /** Whether the URL name may still be changed, and what the last change came to. */
  urlName: Readonly<{ renamable: boolean; notice: SlugNotice | null }>
  publication: PanelView
  /** The deck's related links, and why the last one added was refused. */
  links: Readonly<{
    list: readonly StoredLink[]
    notice: LinkNotice | null
  }>
  /** The events the related links make the slide a talk of. */
  events: readonly DeckEvent[]
  /** The article under the slides; null while there is none. */
  article: ArticleSummary | null
  /** What can be downloaded; none until work E fills it. */
  downloads?: readonly DownloadLink[]
}>

/** The way to the slides: their viewer; nothing without a handle. */
const viewerLinkOf = (view: DeckPageView, lang: Lang) =>
  view.handle === null
    ? ''
    : viewerLink(
        ownerViewerPath(view.handle, view.slug, null),
        panelText[lang].viewInViewer,
      )

/**
 * The page of one of the author's slides, in one column. What it shows is
 * what the author does here, in this order; each part is a frame of its own,
 * so that the feature behind it can change it alone:
 *
 * - the way back and the title, with the button that opens the slides;
 * - publication: the heading, the state and the one button to change it, in one row;
 * - before publication only, the way to change the end of the URL;
 * - the article, the related links and the events they make it a talk of;
 * - a new version, dropped here;
 * - the slides that cite these;
 * - downloads, when there are any;
 * - deletion.
 *
 * The page shows no preview of the slides: the viewer is where they are seen.
 */
export const deckPageBody = (view: DeckPageView, lang: Lang) => {
  const { publication } = view
  const shown = publication.pointed ?? publication.latest
  return html`<div class="deck-page">
    <p>
      <a class="back-link" href="/slides">${text[lang].back}</a>
    </p>
    <div class="deck-head" data-deck-frame="title">
      <h1>${view.name}</h1>
      ${
        shown && publication.delivery && !publication.takedown
          ? viewerLinkOf(view, lang)
          : ''
      }
    </div>
    ${publicationPanel(view.slug, publication, lang)}
    ${shareUrlFrame(
      {
        slug: view.slug,
        shareUrl: view.shareUrl,
        ...view.urlName,
      },
      lang,
    )}
    ${articleFrame(view.slug, view.article, lang)}
    ${linksFrame(
      {
        slug: view.slug,
        links: view.links.list,
        communities: communitiesOf(view.events),
        notice: view.links.notice,
      },
      lang,
    )}
    ${presentedEventsFrame(view.events, lang)}
    ${replaceFrame(view.slug, versionsList(view.slug, view.handle, publication, lang), lang)}
    ${downloadFrame(view.downloads ?? [], lang)}
    ${deletionFrame(view.slug, lang)}
  </div>`
}
