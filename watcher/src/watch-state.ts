import { z } from 'zod'
import { TARGET_NAMES } from './watch-config'
import {
  NO_MAINTENANCE,
  sightOf,
  stepMaintenance,
  unsent as unsentMaintenance,
  type MaintenancePhase,
  type MaintenanceState,
} from './watch-maintenance'
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

const phaseSchema = z.enum(['started', 'overrun', 'ended'])
const maintenanceStateSchema = z.object({
  active: z.boolean(),
  until: z.number().int().nullable(),
  told: z.object({
    started: z.boolean(),
    overrun: z.boolean(),
    ended: z.boolean(),
  }),
})
const sightedSchema = z.object({
  checks: z
    .array(
      z.object({
        seen: z.enum(['ok', 'failed', 'maintenance']),
        until: z.number().int().nullable(),
      }),
    )
    .min(1)
    .max(20),
  now: z.number().int(),
  overrunSeconds: z.number().int().min(60),
})
const maintenanceUnsentSchema = z.object({ phase: phaseSchema })

/** What `/maintenance` answers: which of the three notices to tell, if any. */
export type MaintenanceVerdict = Readonly<{ action: MaintenancePhase | null }>

/** What `/observe` answers: what to tell, and how many checks have failed in a row. */
export type Verdict = Readonly<{ action: Action; failures: number }>

/**
 * The watcher's memory: what each address's checks have come to, kept in the
 * storage of one Durable Object of the watcher's own, so that nothing of the
 * service holds it. Each request is handled whole before the next (a Durable
 * Object runs one at a time), which is what makes the read, the decision and
 * the write one step. It answers four requests, by POST: `/observe` and
 * `/unsent` for each address, and `/maintenance` and `/maintenance-unsent` for
 * the maintenance the service is held for, which no one address owns.
 */
export class WatchState {
  constructor(private readonly ctx: DurableObjectState) {}

  private async read(name: string): Promise<TargetState> {
    const stored = await this.ctx.storage.get(`target:${name}`)
    const parsed = stateSchema.safeParse(stored)
    return parsed.success ? parsed.data : FRESH_STATE
  }

  private async readMaintenance(): Promise<MaintenanceState> {
    const stored = await this.ctx.storage.get('maintenance')
    const parsed = maintenanceStateSchema.safeParse(stored)
    return parsed.success ? parsed.data : NO_MAINTENANCE
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
    if (pathname === '/maintenance') {
      const input = sightedSchema.safeParse(body)
      if (!input.success) return new Response('Bad request', { status: 400 })
      const { checks, now, overrunSeconds } = input.data
      const next = stepMaintenance(
        await this.readMaintenance(),
        sightOf(checks),
        now,
        overrunSeconds,
      )
      await this.ctx.storage.put('maintenance', next.state)
      return Response.json({ action: next.action } satisfies MaintenanceVerdict)
    }
    if (pathname === '/maintenance-unsent') {
      const input = maintenanceUnsentSchema.safeParse(body)
      if (!input.success) return new Response('Bad request', { status: 400 })
      await this.ctx.storage.put(
        'maintenance',
        unsentMaintenance(await this.readMaintenance(), input.data.phase),
      )
      return new Response(null, { status: 204 })
    }
    return new Response('Not found', { status: 404 })
  }
}
