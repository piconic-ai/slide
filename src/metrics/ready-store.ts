import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { deployments } from '../db/schema'

/** When a version became ready, in seconds, or null when it is not ready. */
export async function readReadyAt(
  database: D1Database,
  deploymentId: string,
): Promise<number | null> {
  const row = await drizzle(database)
    .select({ readyAt: deployments.ready_at })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .get()
  return row?.readyAt ?? null
}
