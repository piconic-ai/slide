import { asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { deploymentHosts } from '../db/schema'

/**
 * Hosts shown per deployment. Anyone can post a report, so the list is
 * bounded. One more is kept than is shown: a list filled on purpose, to
 * keep a later host out of it, then tells readers that more were reported.
 */
export const HOSTS_SHOWN = 20
const HOSTS_KEPT = HOSTS_SHOWN + 1

/** The reported hosts a viewer lists, and whether more were reported. */
export type ReportedHosts = Readonly<{
  shown: readonly string[]
  more: boolean
}>

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
    ) < ${HOSTS_KEPT}
    ON CONFLICT DO NOTHING`)
}

/** The hosts reported for a deployment, in the order they were first seen. */
export async function listHosts(
  database: D1Database,
  deploymentId: string,
): Promise<ReportedHosts> {
  const rows = await drizzle(database)
    .select({ host: deploymentHosts.host })
    .from(deploymentHosts)
    .where(eq(deploymentHosts.deployment_id, deploymentId))
    .orderBy(asc(deploymentHosts.first_seen_at), asc(deploymentHosts.host))
  return {
    shown: rows.slice(0, HOSTS_SHOWN).map((row) => row.host),
    more: rows.length > HOSTS_SHOWN,
  }
}
