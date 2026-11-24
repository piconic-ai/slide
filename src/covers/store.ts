import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { deployments } from '../db/schema'

/**
 * What the image of a page needs to know of a deployment: the cover that
 * stands in for a page that could not be taken. Null for an unknown
 * deployment. Whether anyone may see the deployment is the caller's check.
 */
export async function readPageSource(
  database: D1Database,
  deploymentId: string,
): Promise<{ coverPath: string | null } | null> {
  const row = await drizzle(database)
    .select({ coverPath: deployments.cover_path })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .get()
  return row ?? null
}
