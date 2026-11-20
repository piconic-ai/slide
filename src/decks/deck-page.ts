import { html } from 'hono/html'
import type { CitationCard } from '../citations/cards'
import {
  panelText,
  previewForm,
  publicationPanel,
  type PanelView,
} from '../publication/panel'
import { messages, type Lang } from '../site/i18n'
import { citedByFrame } from './cited-by-frame'
import { deletionFrame } from './deletion-frame'
import { versionsList } from './versions-frame'
import { replaceFrame } from './replace-frame'
import { shareUrlFrame } from './share-url-frame'
import type { SlugNotice } from './slug-name'

const text = messages({
  ja: { back: '‹ スライドの管理', title: (name: string) => `${name} の管理` },
  en: { back: '‹ Your slides', title: (name: string) => `Manage ${name}` },
})

/** The page title of one slide's page, for renderPage. */
export const deckPageTitle = (name: string, lang: Lang) =>
  text[lang].title(name)

/** What the page of one of the author's slides shows. */
export type DeckPageView = Readonly<{
  slug: string
  /** The title of the version shown, or the URL name before it has one. */
  name: string
  shareUrl: string | null
  /** Whether the URL name may still be changed, and what the last change came to. */
  urlName: Readonly<{ renamable: boolean; notice: SlugNotice | null }>
  publication: PanelView
  /** The public slides that cite these, newest first. */
  citedBy: readonly CitationCard[]
}>

/**
 * The page of one of the author's slides, in one column. What it shows is
 * what the author does here, in this order; each part is a frame of its own,
 * so that the feature behind it can change it alone:
 *
 * - the way back and the title, with the button that opens the slides;
 * - publication: what readers can do now, and the one button to change it;
 * - the share URL with its name;
 * - a new version, dropped here;
 * - the slides that cite these;
 * - deletion.
 *
 * The page shows no preview of the slides: the viewer is where they are seen.
 */
export const deckPageBody = (view: DeckPageView, lang: Lang) => {
  const { publication } = view
  const isPublic =
    publication.state.publication.kind === 'public' &&
    publication.takedown === null
  const shown = publication.pointed ?? publication.latest
  return html`<div class="deck-page">
    <p>
      <a class="back-link" href="/slides">${text[lang].back}</a>
    </p>
    <div class="deck-head" data-deck-frame="title">
      <h1>${view.name}</h1>
      ${
        shown && publication.delivery
          ? previewForm(
              view.slug,
              shown.deploymentId,
              panelText[lang].viewInViewer,
            )
          : ''
      }
    </div>
    ${publicationPanel(view.slug, publication, lang)}
    ${shareUrlFrame(
      {
        slug: view.slug,
        shareUrl: view.shareUrl,
        isPublic,
        ...view.urlName,
      },
      lang,
    )}
    ${replaceFrame(view.slug, versionsList(view.slug, publication, lang), lang)}
    ${citedByFrame(view.citedBy, lang)} ${deletionFrame(view.slug, lang)}
  </div>`
}
