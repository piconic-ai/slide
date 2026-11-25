import { readViewerCitations } from '../citations/store'
import { listLinks } from '../links/store'
import { readProfile } from '../profile/store'
import type { DeckSlug } from '../decks/deck-id'
import { listDeckEvents } from '../events/store'

/**
 * What the viewer shows around the slides besides the article: their author,
 * the slides on both sides of a citation, the related links, and the events
 * the slides were presented at. The viewer of readers and the author's
 * preview of an article read them the same way, so they look the same.
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
  const [author, citations, links, events] = await Promise.all([
    readProfile(database, deck.ownerUserId),
    readViewerCitations(
      database,
      { deploymentId: deck.deploymentId, handle: deck.handle, slug: deck.slug },
      viewer,
    ),
    listLinks(database, deck.deckId),
    listDeckEvents(database, deck.deckId),
  ])
  return { author, citations, links, events }
}
