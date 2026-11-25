import type { Hono, MiddlewareHandler } from 'hono'
import { checkHandle } from '../auth/handle-rules'
import type { Operator } from '../operator/access'
import { renameHandle, resolveHandle } from '../handles/store'
import type { Handle } from '../share/handle'
import {
  addCommunityAdmin,
  deleteCommunity,
  findPersonByHandle,
  removeCommunityAdmin,
} from './admin-store'
import { communityOwner } from './store'

/** What an operator's action on a community left to say, as `?result=`. */
export const COMMUNITY_RESULTS = [
  'community_admin_added',
  'community_admin_removed',
  'community_admin_last',
  'community_person_unknown',
  'community_renamed',
  'community_handle_taken',
  'community_handle_held',
  'community_handle_invalid',
  'community_deleted',
  'community_not_found',
  'community_confirm_mismatch',
] as const
export type CommunityResult = (typeof COMMUNITY_RESULTS)[number]

const handleOf = (value: unknown): Handle | null => {
  if (typeof value !== 'string') return null
  const checked = checkHandle(value.trim().replace(/^@/u, '').toLowerCase())
  return checked.kind === 'valid' ? checked.handle : null
}

/** The community a typed handle names, or null. */
async function communityOf(database: D1Database, value: unknown) {
  const handle = handleOf(value)
  if (handle === null) return null
  const held = await resolveHandle(database, handle)
  return held.kind === 'community'
    ? { id: Number(held.communityId), handle }
    : null
}

type OperatorEnv = { Bindings: Env; Variables: { operator: Operator } }

const now = () => Math.floor(Date.now() / 1000)

/**
 * The operator's actions on communities (F30-AC36): add or remove an admin,
 * change a handle, delete. Only the operator host reaches them; `guard`
 * is its check that a change comes from that origin.
 */
export function mountCommunityOperator(
  app: Hono<OperatorEnv>,
  guard: MiddlewareHandler<OperatorEnv>,
) {
  const done = (result: CommunityResult) => `/?result=${result}`
  app.post('/communities/admins/add', guard, async (c) => {
    const form = await c.req.parseBody()
    const community = await communityOf(c.env.DB, form.community)
    if (!community) return c.redirect(done('community_not_found'), 303)
    const person = handleOf(form.person)
    const result =
      person === null
        ? 'no_person'
        : await addCommunityAdmin(c.env.DB, {
            communityId: community.id,
            handle: person,
            now: now(),
          })
    return c.redirect(
      done(
        result === 'no_person'
          ? 'community_person_unknown'
          : 'community_admin_added',
      ),
      303,
    )
  })
  app.post('/communities/admins/remove', guard, async (c) => {
    const form = await c.req.parseBody()
    const community = await communityOf(c.env.DB, form.community)
    if (!community) return c.redirect(done('community_not_found'), 303)
    const person = handleOf(form.person)
    const userId =
      person === null ? null : await findPersonByHandle(c.env.DB, person)
    if (userId === null)
      return c.redirect(done('community_person_unknown'), 303)
    const result = await removeCommunityAdmin(c.env.DB, {
      communityId: community.id,
      userId,
    })
    const message = {
      removed: 'community_admin_removed',
      last: 'community_admin_last',
      not_admin: 'community_person_unknown',
    } as const
    return c.redirect(done(message[result]), 303)
  })
  app.post('/communities/rename', guard, async (c) => {
    const form = await c.req.parseBody()
    const community = await communityOf(c.env.DB, form.community)
    if (!community) return c.redirect(done('community_not_found'), 303)
    const to = handleOf(form.to)
    if (to === null) return c.redirect(done('community_handle_invalid'), 303)
    const result = await renameHandle(c.env.DB, {
      owner: communityOwner(community.id),
      to,
      now: now(),
    })
    const message = {
      renamed: 'community_renamed',
      taken: 'community_handle_taken',
      held: 'community_handle_held',
      no_handle: 'community_not_found',
    } as const
    return c.redirect(done(message[result]), 303)
  })
  app.post('/communities/delete', guard, async (c) => {
    const form = await c.req.parseBody()
    const community = await communityOf(c.env.DB, form.community)
    if (!community) return c.redirect(done('community_not_found'), 303)
    if (handleOf(form.confirm) !== community.handle)
      return c.redirect(done('community_confirm_mismatch'), 303)
    await deleteCommunity(
      { database: c.env.DB, bucket: c.env.UPLOADS },
      { communityId: community.id, now: now() },
    )
    return c.redirect(done('community_deleted'), 303)
  })
}
