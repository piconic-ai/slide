import type { MiddlewareHandler } from 'hono'
import { HELP_CATALOG } from '../help/default-catalog'
import { isHtml } from '../site/no-transform'
import { langOf } from '../site/lang'
import { maintenanceHelpPath } from './help-link'
import { isShown, type MaintenanceNotice } from './notice'
import { HEADER_MARKER, maintenanceBand } from './notice-band'
import { readNotice } from './notice-store'
import { isMaintenance } from './switch'

/** How long an isolate keeps what it read before it reads D1 again (seconds). */
export const NOTICE_TTL_SECONDS = 60

/** How long it keeps the news that D1 could not be read, so as not to ask again at once. */
export const NOTICE_FAILURE_TTL_SECONDS = 15

type Entry = Readonly<{
  at: number
  ttl: number
  notice: MaintenanceNotice | null
}>

/**
 * A short memory of the plan, so that the band does not cost a D1 read on every
 * request (F38-AC1, design: "予告の帯の読み方"). An isolate reads the row at most
 * once in `NOTICE_TTL_SECONDS`, however many requests it answers; requests that
 * arrive while it reads share that one read. A D1 that cannot be read is kept
 * as "no plan" for a shorter time: the band is a courtesy and must never take a
 * page down with it.
 */
export function createNoticeCache(
  read: (env: Env) => Promise<MaintenanceNotice | null>,
  now: () => number,
) {
  let entry: Entry | null = null
  let loading: Promise<MaintenanceNotice | null> | null = null

  const load = async (env: Env): Promise<MaintenanceNotice | null> => {
    try {
      const notice = await read(env)
      entry = { at: now(), ttl: NOTICE_TTL_SECONDS, notice }
      return notice
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'maintenance_notice_unreadable',
          name: error instanceof Error ? error.name : 'unknown',
        }),
      )
      entry = { at: now(), ttl: NOTICE_FAILURE_TTL_SECONDS, notice: null }
      return null
    }
  }

  return {
    get(env: Env): Promise<MaintenanceNotice | null> {
      if (entry && now() - entry.at < entry.ttl)
        return Promise.resolve(entry.notice)
      loading ??= load(env).finally(() => {
        loading = null
      })
      return loading
    },
    /** Forgets what was read, so that the next request reads again. */
    forget() {
      entry = null
    },
  }
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

/** The cache of this isolate, over the row in D1. */
export const noticeCache = createNoticeCache(
  (env) => readNotice(env.DB),
  nowSeconds,
)

/** What the middleware tells the handlers behind it. */
export type NoticeVariables = { noticeShown?: boolean }

/** Headers the band makes stale: the body is longer, and no longer the file it was. */
const STALE_HEADERS = [
  'Content-Length',
  'Content-Encoding',
  'ETag',
  'Last-Modified',
]

/**
 * Puts the band over the header of every page while a plan is out (F38-AC1,
 * AC4, AC5). Pages are made as they always were; the band is put in front of
 * their header on the way out, so that no page needs to know of it. Nothing
 * is read or changed when no plan is out, which is nearly always. It does
 * not run while maintenance holds the service: the page then says so itself,
 * and D1 is not to be read. A 503 gets no band.
 */
export const noticeBand =
  (
    cache: ReturnType<typeof createNoticeCache> = noticeCache,
    now: () => number = nowSeconds,
  ): MiddlewareHandler<{ Bindings: Env; Variables: NoticeVariables }> =>
  async (c, next) => {
    if (isMaintenance(c.env.MAINTENANCE)) return next()
    const notice = await cache.get(c.env)
    if (!notice || !isShown(notice, now())) return next()
    // A page kept by the browser for a revalidation would be the page without
    // the band, so the pages that are static files must not answer 304.
    c.set('noticeShown', true)
    await next()
    const res = c.res
    if (
      res.status === 503 ||
      !res.body ||
      !isHtml(res.headers.get('Content-Type'))
    )
      return
    const page = await res.clone().text()
    const at = page.indexOf(HEADER_MARKER)
    if (at < 0) return
    const band = String(
      await maintenanceBand(
        notice,
        langOf(c),
        maintenanceHelpPath(HELP_CATALOG),
      ),
    )
    try {
      for (const name of STALE_HEADERS) res.headers.delete(name)
    } catch {
      // Headers that cannot be changed are left; the runtime sets the length.
    }
    c.res = new Response(page.slice(0, at) + band + page.slice(at), res)
  }
