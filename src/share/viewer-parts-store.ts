import { readViewerCitations } from '../citations/store'
import { listLinks } from '../links/store'
import { readProfile } from '../profile/store'
import type { DeckSlug } from '../decks/deck-id'
import { listViewerEvents } from './viewer-events-store'
import { readViewerTalks } from './viewer-talks-store'

/**
 * What the viewer shows around the slides besides the article: their author,
 * the slides on both sides of a citation, the related links, the events
 * the slides were presented at, and the other talks of the first of them and
 * of its community. The viewer of readers and the author's
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
  const eventsAndTalks = listViewerEvents(database, deck.deckId).then(
    async (events) => ({
      events,
      talks: await readViewerTalks(database, {
        deckId: deck.deckId,
        events,
        viewer,
      }),
    }),
  )
  const [author, citations, links, { events, talks }] = await Promise.all([
    readProfile(database, deck.ownerUserId),
    readViewerCitations(
      database,
      { deploymentId: deck.deploymentId, handle: deck.handle, slug: deck.slug },
      viewer,
    ),
    listLinks(database, deck.deckId),
    eventsAndTalks,
  ])
  return { author, citations, links, events, talks }
}
