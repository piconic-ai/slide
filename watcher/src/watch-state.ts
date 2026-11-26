import { z } from 'zod'
import { TARGET_NAMES } from './watch-config'
import {
  FRESH_STATE,
  step,
  unsent,
  type Action,
  type TargetState,
} from './watch-step'

const stateSchema = z.object({
  failures: z.number().int().min(0),
  noticeSent: z.boolean(),
  lastNoticeAt: z.number().int().nullable(),
  // Absent in what an earlier version stored.
  maintenance: z.number().int().min(0).default(0),
})

const nameSchema = z.enum(TARGET_NAMES)

const observeSchema = z.object({
  name: nameSchema,
  seen: z.enum(['ok', 'failed', 'maintenance']),
  now: z.number().int(),
  rules: z.object({
    failuresToTell: z.number().int().min(1),
    throttleSeconds: z.number().int().min(1),
    maintenanceChecksToFail: z.number().int().min(1),
  }),
})
const unsentSchema = z.object({ name: nameSchema })

/** What `/observe` answers: what to tell, and how many checks have failed in a row. */
export type Verdict = Readonly<{ action: Action; failures: number }>

/**
 * The watcher's memory: what each address's checks have come to, kept in the
 * storage of one Durable Object of the watcher's own, so that nothing of the
 * service holds it. Each request is handled whole before the next (a Durable
 * Object runs one at a time), which is what makes the read, the decision and
 * the write one step. It answers two requests, by POST: `/observe` and
 * `/unsent`.
 */
export class WatchState {
  constructor(private readonly ctx: DurableObjectState) {}

  private async read(name: string): Promise<TargetState> {
    const stored = await this.ctx.storage.get(`target:${name}`)
    const parsed = stateSchema.safeParse(stored)
    return parsed.success ? parsed.data : FRESH_STATE
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (request.method !== 'POST')
      return new Response('Method not allowed', { status: 405 })
    const body: unknown = await request.json().catch(() => null)
    if (pathname === '/observe') {
      const input = observeSchema.safeParse(body)
      if (!input.success) return new Response('Bad request', { status: 400 })
      const { name, seen, now, rules } = input.data
      const next = step(await this.read(name), seen, now, rules)
      await this.ctx.storage.put(`target:${name}`, next.state)
      return Response.json({
        action: next.action,
        failures: next.state.failures,
      } satisfies Verdict)
    }
    if (pathname === '/unsent') {
      const input = unsentSchema.safeParse(body)
      if (!input.success) return new Response('Bad request', { status: 400 })
      await this.ctx.storage.put(
        `target:${input.data.name}`,
        unsent(await this.read(input.data.name)),
      )
      return new Response(null, { status: 204 })
    }
    return new Response('Not found', { status: 404 })
  }
}
