import { Hono } from 'hono'
import { z } from 'zod'
import { readAccessFacts } from '../preview/access-store'
import { listHosts } from './store'

export const safetyRoutes = new Hono<{ Bindings: Env }>()

const deploymentIdSchema = z.uuid()

/** Where a viewer reads the hosts reported for the version it shows. */
export const hostsPath = (deploymentId: string) =>
  `/api/public/deployments/${deploymentId}/hosts`

/**
 * The hosts reported for a version anyone may read. The viewer asks again
 * each time a reader opens the list, since reports arrive while slides run.
 */
safetyRoutes.get('/api/public/deployments/:id/hosts', async (c) => {
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
  return c.json(await listHosts(c.env.DB, id.data))
})
