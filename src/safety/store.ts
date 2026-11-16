import { asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { deploymentHosts } from '../db/schema'

/**
 * Hosts kept per deployment. Anyone can post a report, so the list is
 * bounded; a slide that reaches more hosts than this shows the first ones.
 */
export const HOSTS_PER_DEPLOYMENT = 20

/** Keeps a reported host, unless the deployment already holds its share. */
export async function recordHost(
  database: D1Database,
  input: Readonly<{ deploymentId: string; host: string; now: number }>,
): Promise<void> {
  // One statement, so reports arriving together cannot pass the bound.
  await drizzle(database).run(sql`
    INSERT INTO ${deploymentHosts} (deployment_id, host, first_seen_at)
    SELECT ${input.deploymentId}, ${input.host}, ${input.now}
    WHERE (
      SELECT count(*) FROM ${deploymentHosts}
      WHERE ${deploymentHosts.deployment_id} = ${input.deploymentId}
    ) < ${HOSTS_PER_DEPLOYMENT}
    ON CONFLICT DO NOTHING`)
}

/** The hosts reported for a deployment, in a stable order. */
export async function listHosts(
  database: D1Database,
  deploymentId: string,
): Promise<string[]> {
  const rows = await drizzle(database)
    .select({ host: deploymentHosts.host })
    .from(deploymentHosts)
    .where(eq(deploymentHosts.deployment_id, deploymentId))
    .orderBy(asc(deploymentHosts.host))
  return rows.map((row) => row.host)
}
