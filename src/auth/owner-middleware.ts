import type { Context, MiddlewareHandler } from 'hono'
import type { Suspension } from '../publication/suspension'
import { readSuspension } from '../publication/suspension-store'
import { ownerSession, type Owner } from './owner-session'

type OwnerEnv = { Bindings: Env; Variables: { owner: Owner } }
type OwnerOptions = Readonly<{ allowSuspended?: true }>

export class SuspendedOwnerError extends Error {
  constructor(
    readonly owner: Owner,
    readonly suspension: Suspension,
  ) {
    super('Account suspended')
    this.name = 'SuspendedOwnerError'
  }
}

/** Owner-dependent operations refuse suspended accounts unless opted in. */
export async function currentOwner<E extends { Bindings: Env }>(
  c: Context<E>,
  options: OwnerOptions = {},
): Promise<Owner | null> {
  const owner = (await ownerSession(c))?.owner ?? null
  if (!owner || options.allowSuspended) return owner
  const suspension = await readSuspension(c.env.DB, owner.userId)
  if (suspension) throw new SuspendedOwnerError(owner, suspension)
  return owner
}

function ownerMiddleware(options: OwnerOptions): MiddlewareHandler<OwnerEnv> {
  return async (c, next) => {
    const owner = await currentOwner(c, options)
    if (!owner) return c.json({ error: 'Sign in as the owner' }, 401)
    c.set('owner', owner)
    await next()
  }
}

export const requireOwner = ownerMiddleware({})
export const requireOwnerEvenSuspended = ownerMiddleware({
  allowSuspended: true,
})
