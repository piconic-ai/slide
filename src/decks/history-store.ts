import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import {
  deploymentRowSchema,
  deployments,
  decks,
  uploadFiles,
} from '../db/schema'
import {
  historyEntry,
  MISSING_PATHS_SHOWN,
  type HistoryCursor,
  type HistoryEntry,
} from './history'

// The page's IDs are bound as parameters; D1 allows at most 100 per query.
export const HISTORY_PAGE_SIZE = 50

const progressSchema = z.object({
  deploymentId: z.string(),
  total: z.number().int().nonnegative(),
  received: z.number().int().nonnegative(),
})
const missingSchema = z.object({ deploymentId: z.string(), path: z.string() })

/**
 * Lists a deck's deployments, newest first, for its owner. Returns null when
 * the deck does not exist or belongs to someone else, so callers can answer
 * both the same way.
 */
export async function listDeckHistory(
  database: D1Database,
  input: Readonly<{
    deckId: string
    ownerUserId: string
    now: number
    before?: HistoryCursor
  }>,
): Promise<HistoryEntry[] | null> {
  const db = drizzle(database)
  const deck = await db
    .select({ id: decks.id })
    .from(decks)
    .where(
      and(
        eq(decks.id, input.deckId),
        eq(decks.owner_user_id, input.ownerUserId),
      ),
    )
    .get()
  if (!deck) return null
  const rows = await db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.deck_id, input.deckId),
        input.before &&
          or(
            lt(deployments.created_at, input.before.createdAt),
            and(
              eq(deployments.created_at, input.before.createdAt),
              lt(deployments.id, input.before.id),
            ),
          ),
      ),
    )
    .orderBy(desc(deployments.created_at), desc(deployments.id))
    .limit(HISTORY_PAGE_SIZE)
    .all()
    .then((result) => deploymentRowSchema.array().parse(result))
  if (!rows.length) return []
  const ids = rows.map(({ id }) => id)
  const [progress, missing] = await db.batch([
    db
      .select({
        deploymentId: uploadFiles.deployment_id,
        total: sql<number>`COUNT(*)`,
        received: sql<number>`COUNT(${uploadFiles.object_key})`,
      })
      .from(uploadFiles)
      .where(inArray(uploadFiles.deployment_id, ids))
      .groupBy(uploadFiles.deployment_id),
    // Window the unreceived paths per deployment so a large inventory does
    // not load every path.
    db
      .select({
        deploymentId: sql<string>`deployment_id`.as('deploymentId'),
        path: sql<string>`path`.as('path'),
      })
      .from(
        db
          .select({
            deployment_id: uploadFiles.deployment_id,
            path: uploadFiles.path,
            rank: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${uploadFiles.deployment_id} ORDER BY ${uploadFiles.path})`.as(
              'rank',
            ),
          })
          .from(uploadFiles)
          .where(
            and(
              inArray(uploadFiles.deployment_id, ids),
              isNull(uploadFiles.object_key),
            ),
          )
          .as('missing'),
      )
      .where(sql`rank <= ${MISSING_PATHS_SHOWN}`),
  ])
  const counts = new Map(
    progressSchema
      .array()
      .parse(progress)
      .map((row) => [row.deploymentId, row]),
  )
  const paths = Map.groupBy(
    missingSchema.array().parse(missing),
    ({ deploymentId }) => deploymentId,
  )
  return rows.map((row) =>
    historyEntry(
      row,
      {
        total: counts.get(row.id)?.total ?? 0,
        received: counts.get(row.id)?.received ?? 0,
        missing: (paths.get(row.id) ?? []).map(({ path }) => path).sort(),
      },
      input.now,
    ),
  )
}
