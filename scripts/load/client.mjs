// The only way the load scripts send a request. Each address is judged by
// origin-guard.mjs before anything leaves, a redirect is never followed (it
// could lead to production), the number of requests is capped, and every
// response, or failure, is kept as a record for the report.
import { checkAddress, RefusedAddress } from './origin-guard.mjs'

/** Thrown when a run has sent as many requests as it was allowed. */
export class RequestBudgetSpent extends Error {
  constructor(limit) {
    super(`The run reached its limit of ${limit} requests`)
    this.name = 'RequestBudgetSpent'
  }
}

/**
 * @typedef {{
 *   send: (address: string, init: RequestInit) => Promise<Response>,
 *   now: () => number,
 *   timeoutSignal: (ms: number) => AbortSignal,
 *   records: import('./stats.mjs').Record[],
 *   maxRequests: number,
 *   timeoutMs: number,
 *   clientIp: string | null,
 * }} ClientDeps
 */

/** @param {ClientDeps} deps */
export function makeClient(deps) {
  let sent = 0
  return {
    get sent() {
      return sent
    },
    /**
     * Sends one request and keeps its record. Refuses, before sending, an
     * address of production or a run past its limit. A failed connection is a
     * record with no status, not an error thrown.
     *
     * @param {string} name what the request is for, as the report groups it
     * @param {string} address
     * @param {RequestInit & { headers?: Record<string, string> }} [init]
     */
    async request(name, address, init = {}) {
      const checked = checkAddress(address)
      if (!checked.ok) throw new RefusedAddress(`${name}: ${checked.reason}`)
      if (sent >= deps.maxRequests)
        throw new RequestBudgetSpent(deps.maxRequests)
      sent++
      const headers = { ...init.headers }
      // Only a local Worker takes the address from this header; on the
      // internet Cloudflare sets it, so it is not sent there.
      if (deps.clientIp && checked.local)
        headers['CF-Connecting-IP'] = deps.clientIp
      const started = deps.now()
      try {
        const response = await deps.send(checked.url.href, {
          ...init,
          headers,
          redirect: 'manual',
          signal: deps.timeoutSignal(deps.timeoutMs),
        })
        const body = new Uint8Array(await response.arrayBuffer())
        deps.records.push({
          name,
          status: response.status,
          ms: deps.now() - started,
        })
        return {
          status: response.status,
          url: checked.url.href,
          headers: response.headers,
          body,
          text: () => new TextDecoder().decode(body),
        }
      } catch (error) {
        if (error instanceof RefusedAddress) throw error
        deps.records.push({ name, status: null, ms: deps.now() - started })
        return {
          status: null,
          url: checked.url.href,
          headers: new Headers(),
          body: new Uint8Array(),
          text: () => '',
        }
      }
    },
  }
}
