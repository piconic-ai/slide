import { html } from 'hono/html'
import type { CitationCard } from '../citations/cards'
import { publicationPanel, type PanelView } from '../publication/panel'
import { deckCover } from '../site/deck-card'
import { messages, type Lang } from '../site/i18n'
import { citedByFrame } from './cited-by-frame'
import { deletionFrame } from './deletion-frame'
import { embedCodeFrame } from './embed-code-frame'
import type { HistoryEntry } from './history'
import { historyFrame } from './history-frame'
import { replaceFrame } from './replace-frame'
import { shareUrlFrame } from './share-url-frame'

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
  /** The cover of the version shown; missing while nothing is received. */
  coverUrl: string | null
  shareUrl: string | null
  entries: readonly HistoryEntry[]
  olderCursor: string | null
  publication: PanelView
  /** The public slides that cite these, newest first. */
  citedBy: readonly CitationCard[]
}>

/**
 * The page of one of the author's slides, in two columns that become one on
 * a narrow screen, the right column first. Each part is a frame of its own,
 * so that the feature behind it can change it alone:
 *
 * - left: the preview and title, replacing the slides, the versions, and
 *   the slides that cite these;
 * - right: publication, the share URL with its name, the embed code, and
 *   deletion.
 *
 * One link above the title leads back to the list; no other navigation is
 * scattered through the page.
 */
export const deckPageBody = (view: DeckPageView, lang: Lang) => {
  const { publication } = view
  const isPublic =
    publication.state.publication.kind === 'public' &&
    publication.takedown === null
  return html`<p>
      <a class="back-link" href="/slides">${text[lang].back}</a>
    </p>
    <div class="deck-layout">
      <div class="deck-side">
        ${publicationPanel(view.slug, publication, lang)}
        ${shareUrlFrame(
          { slug: view.slug, shareUrl: view.shareUrl, isPublic },
          lang,
        )}
        ${embedCodeFrame(
          { shareUrl: view.shareUrl, name: view.name, isPublic },
          lang,
        )}
        ${deletionFrame(view.slug, lang)}
      </div>
      <div class="deck-main">
        <div class="deck-preview" data-deck-frame="preview">
          ${deckCover(view.name, view.coverUrl)}
        </div>
        <h1>${view.name}</h1>
        ${replaceFrame(lang)}
        ${historyFrame(
          view.slug,
          view.entries,
          view.olderCursor,
          publication,
          lang,
        )}
        ${citedByFrame(view.citedBy, lang)}
      </div>
    </div>`
}
