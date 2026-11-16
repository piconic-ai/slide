import { Hono } from 'hono'
import { z } from 'zod'
import { readAccessFacts } from '../preview/access-store'
import { langOf } from '../site/lang'
import type { Lang } from '../site/i18n'
import { trafficTable } from './pages'
import { listTraffic, TRAFFIC_KEPT, TRAFFIC_KEPT_PER_GROUP } from './store'
import { summarize } from './summary'

export const safetyRoutes = new Hono<{ Bindings: Env }>()

const deploymentIdSchema = z.uuid()

/** Where a viewer reads the traffic table of the version it shows. */
export const trafficPath = (deploymentId: string, lang: Lang) =>
  `/api/public/deployments/${deploymentId}/traffic?lang=${lang}`

/** The table of what a version's files were reported to exchange. */
export const readTrafficSummary = async (database: D1Database, id: string) =>
  summarize(await listTraffic(database, id), {
    kept: TRAFFIC_KEPT,
    keptPerGroup: TRAFFIC_KEPT_PER_GROUP,
  })

/**
 * The traffic table of a version anyone may read, as markup in the reader's
 * language. The viewer asks again each time a reader opens the table, since
 * reports arrive while slides run.
 */
safetyRoutes.get('/api/public/deployments/:id/traffic', async (c) => {
  c.header('Cache-Control', 'no-store')
  const id = deploymentIdSchema.safeParse(c.req.param('id'))
  const facts =
    id.success &&
    (await readAccessFacts(c.env.DB, {
      deploymentId: id.data,
      sessionToken: null,
      allowedOwnerId: c.env.GITHUB_ACTOR_ID,
      now: Math.floor(Date.now() / 1000),
    }))
  // A draft, a stopped version and a missing one answer alike.
  if (!id.success || !facts || !facts.isPublic)
    return c.json({ error: 'Not found' }, 404)
  return c.html(
    trafficTable(await readTrafficSummary(c.env.DB, id.data), langOf(c)),
  )
})
