import type { Context, Hono, MiddlewareHandler } from 'hono'
import { parseNoticeForm, isShown, type NoticeForm } from './notice'
import { clearNotice, readNotice, saveNotice } from './notice-store'
import { noticeCache } from './notice-middleware'
import {
  readyView,
  type MaintenanceFrameView,
} from '../operator/operations-maintenance-frame'
import type { OperatorEnv } from '../operator/operator-env'

const nowSeconds = () => Math.floor(Date.now() / 1000)

/** What the frame "メンテナンスの予定" shows when the operations page opens. */
export async function readMaintenanceFrame(
  env: Env,
): Promise<MaintenanceFrameView> {
  // Read from D1 itself and not from the memory of the band: the operator
  // must see what is stored.
  const current = await readNotice(env.DB)
  return readyView(current, current !== null && isShown(current, nowSeconds()))
}

/** A form field as text, and nothing else: a file or a list is not a value. */
const field = (value: unknown) =>
  typeof value === 'string' ? value.slice(0, 64) : ''

/** How the operations page is drawn again, with its frame as given. */
type Render = (
  c: Context<OperatorEnv>,
  maintenance: MaintenanceFrameView,
  status: 400,
) => Response | Promise<Response>

/**
 * The two forms of the frame, on the operator host only (F38-AC1, AC5, AC6,
 * AC7). A plan that cannot be read comes back as the page with what was typed
 * and what is wrong, and nothing is stored. A plan that is stored is put in
 * front of the band's memory at once in this isolate; the others read it
 * within `NOTICE_TTL_SECONDS`.
 */
export function mountNotice(
  app: Hono<OperatorEnv>,
  sameOrigin: MiddlewareHandler<OperatorEnv>,
  render: Render,
) {
  app.post('/operations/maintenance', sameOrigin, async (c) => {
    const body = await c.req.parseBody()
    const form: NoticeForm = {
      startsAt: field(body.starts_at),
      endsAt: field(body.ends_at),
      reason: field(body.reason),
    }
    const now = nowSeconds()
    const input = parseNoticeForm(form, now)
    if (input.kind === 'invalid') {
      const current = await readNotice(c.env.DB)
      return render(
        c,
        {
          ...readyView(current, current !== null && isShown(current, now)),
          form,
          problem: input.problem,
        },
        400,
      )
    }
    await saveNotice(c.env.DB, input.notice, now)
    noticeCache.forget()
    const result = input.soon ? 'saved_soon' : 'saved'
    return c.redirect(`/operations?maintenance=${result}#maintenance`, 303)
  })

  app.post('/operations/maintenance/clear', sameOrigin, async (c) => {
    const had = await clearNotice(c.env.DB)
    noticeCache.forget()
    const result = had ? 'cleared' : 'nothing_to_clear'
    return c.redirect(`/operations?maintenance=${result}#maintenance`, 303)
  })
}
