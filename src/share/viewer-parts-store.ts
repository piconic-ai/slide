import { readViewerCitations } from '../citations/store'
import { listLinks } from '../links/store'
import { readProfile } from '../profile/store'
import type { DeckSlug } from '../decks/deck-id'

/**
 * What the viewer shows around the slides besides the article: their author,
 * the slides on both sides of a citation, and the related links. The viewer
 * of readers and the author's preview of an article read them the same way,
 * so they look the same.
 */
export async function readViewerParts(
  database: D1Database,
  deck: Readonly<{
    deckId: string
    deploymentId: string
    handle: string
    slug: DeckSlug
    ownerUserId: string
  }>,
  viewer: string | null,
) {
  const [author, citations, links] = await Promise.all([
    readProfile(database, deck.ownerUserId),
    readViewerCitations(database, deck, viewer),
    listLinks(database, deck.deckId),
  ])
  return { author, citations, links }
}
