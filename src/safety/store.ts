import { asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { deploymentTraffic } from '../db/schema'
import type { Traffic } from './traffic'

/**
 * Records kept per deployment. Anyone can post a report, so both are
 * bounded. A host and kind hold a share of their own, so many files from
 * one place (a font split into a hundred files) leave room for the rest.
 */
export const TRAFFIC_KEPT = 600
export const TRAFFIC_KEPT_PER_GROUP = 150
/** Records taken from one request. */
export const TRAFFIC_PER_REQUEST = 50

/** Keeps reported records, unless the deployment already holds its share. */
export async function recordTraffic(
  database: D1Database,
  input: Readonly<{
    deploymentId: string
    traffic: readonly Traffic[]
    now: number
  }>,
): Promise<void> {
  // One statement each, so reports arriving together cannot pass the
  // bounds.
  const statement = database.prepare(`
    INSERT INTO deployment_traffic
      (deployment_id, kind, host, path, page, first_seen_at)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6
    WHERE (
      SELECT count(*) FROM deployment_traffic WHERE deployment_id = ?1
    ) < ${TRAFFIC_KEPT}
    AND (
      SELECT count(*) FROM deployment_traffic
      WHERE deployment_id = ?1 AND kind = ?2 AND host = ?3
    ) < ${TRAFFIC_KEPT_PER_GROUP}
    ON CONFLICT DO NOTHING`)
  const statements = input.traffic
    .slice(0, TRAFFIC_PER_REQUEST)
    .map((item) =>
      statement.bind(
        input.deploymentId,
        item.kind,
        item.host,
        item.path,
        item.page,
        input.now,
      ),
    )
  if (statements.length > 0) await database.batch(statements)
}

/** A deployment's records, in the order they were first reported. */
export async function listTraffic(
  database: D1Database,
  deploymentId: string,
): Promise<Traffic[]> {
  const rows = await drizzle(database)
    .select()
    .from(deploymentTraffic)
    .where(eq(deploymentTraffic.deployment_id, deploymentId))
    // Records of one second stay in the order they were kept.
    .orderBy(asc(deploymentTraffic.first_seen_at), asc(sql`rowid`))
  return rows.map((row) => ({
    kind: row.kind as Traffic['kind'],
    host: row.host,
    path: row.path,
    page: row.page,
  }))
}
