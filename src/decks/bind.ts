import type { Context } from 'hono'
import { fetchRepository } from '../auth/github-client'
import type { Owner } from '../auth/owner-session'
import {
  bindingDecision,
  githubRepositorySchema,
  type BindingRequest,
} from './binding'
import { saveBinding } from './store'

const refusals = {
  not_found: 'Repository not found. Install the GitHub App on it and try again',
  not_admin: 'Connecting a repository requires admin permission on it',
} as const

/** Verifies admin permission with the user's token and stores the binding. */
export async function bindRepository(
  c: Context<{ Bindings: Env }>,
  request: BindingRequest,
  owner: Owner,
  token: string,
) {
  const parsed = githubRepositorySchema.safeParse(
    await fetchRepository(token, request.repository),
  )
  const decision = bindingDecision(parsed.success ? parsed.data : null)
  if (!decision.ok)
    return c.text(
      refusals[decision.reason],
      decision.reason === 'not_admin' ? 403 : 404,
    )
  const saved = await saveBinding(c.env.DB, {
    ownerUserId: owner.userId,
    request,
    repository: decision,
    now: Math.floor(Date.now() / 1000),
  })
  if (!saved) return c.text('This deck belongs to another owner', 409)
  return c.redirect(`/?connected=${encodeURIComponent(request.deck)}`)
}
