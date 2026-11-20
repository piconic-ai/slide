import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { deployments, pageScriptDeployments } from '../db/schema'

/**
 * What the image of a page needs to know of a deployment: whether its pages
 * may be taken, and the cover that stands in for a page that could not be.
 * Null for an unknown deployment. Whether anyone may see the deployment is
 * the caller's check.
 */
export async function readPageSource(
  database: D1Database,
  deploymentId: string,
): Promise<{ loadsPageScript: boolean; coverPath: string | null } | null> {
  const row = await drizzle(database)
    .select({
      noted: pageScriptDeployments.deployment_id,
      coverPath: deployments.cover_path,
    })
    .from(deployments)
    .leftJoin(
      pageScriptDeployments,
      eq(pageScriptDeployments.deployment_id, deployments.id),
    )
    .where(eq(deployments.id, deploymentId))
    .get()
  return row
    ? { loadsPageScript: row.noted !== null, coverPath: row.coverPath }
    : null
}
