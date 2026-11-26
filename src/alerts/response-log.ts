import { limitGroupOf } from '../site/rate-limit-policy'

/** Which of the service's origins answered. */
export type OriginKind = 'management' | 'content' | 'operator'

/**
 * The one line to log for an answer that Cloudflare's alerts count (D-62), or
 * null for an answer that is not one of them.
 *
 * - A 5xx is `http_5xx`, with the origin and the status. Over the total of
 *   the Worker's invocations it is the share of failures (5xx rate alert).
 * - A 429 is `http_limited`, with the origin, the status and the kind of limit
 *   that held the request back (`auth`, `uploads`, `management`, `viewer`,
 *   `content`, or `other`) (rate-limit alert).
 *
 * The line has no path, no address and no person: only what the alerts group by.
 */
export function responseLogOf(
  origin: OriginKind,
  path: string,
  status: number,
): Readonly<Record<string, string | number>> | null {
  if (status >= 500) return { event: 'http_5xx', origin, status }
  if (status !== 429) return null
  const group =
    origin === 'content'
      ? 'content'
      : origin === 'operator'
        ? 'other'
        : (limitGroupOf(path) ?? 'other')
  return { event: 'http_limited', origin, group, status }
}
