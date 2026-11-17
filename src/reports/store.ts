import { drizzle } from 'drizzle-orm/d1'
import { reports } from '../db/schema'
import type { DeckId } from '../decks/binding'
import type { Report } from './report'

export async function saveReport(
  database: D1Database,
  input: Readonly<
    Report & {
      deckId: DeckId
      deploymentId: string
      sharePath: string
      reporterUserId: string
      now: number
    }
  >,
): Promise<void> {
  const updated = {
    reason: input.reason,
    note: input.note,
    deployment_id: input.deploymentId,
    share_path: input.sharePath,
    updated_at: input.now,
  }
  await drizzle(database)
    .insert(reports)
    .values({
      ...updated,
      id: crypto.randomUUID(),
      deck_id: input.deckId,
      reporter_user_id: input.reporterUserId,
      created_at: input.now,
    })
    .onConflictDoUpdate({
      target: [reports.deck_id, reports.reporter_user_id],
      set: updated,
    })
}
