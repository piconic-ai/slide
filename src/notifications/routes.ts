import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { z } from 'zod'
import { currentOwner } from '../auth/owner-middleware'
import { accountTitles, renderPage, signInPrompt } from '../decks/pages'
import { formOnly } from '../site/form-only-middleware'
import { langOf } from '../site/lang'
import { DELIVERED_KINDS } from './notification'
import { notificationsBody, notificationsTitle } from './pages'
import { openNotifications, setReceive } from './store'

export const notificationRoutes = new Hono<{ Bindings: Env }>()

const preferenceSchema = z.object({
  kind: z.enum(DELIVERED_KINDS),
  receive: z.enum(['1', '0']),
})

notificationRoutes.get('/', async (c) => {
  const owner = await currentOwner(c)
  const lang = langOf(c)
  if (!owner)
    return renderPage(
      c,
      accountTitles(lang).signInTitle,
      signInPrompt(lang),
      401,
    )
  const items = await openNotifications(
    c.env.DB,
    owner.userId,
    50,
    Math.floor(Date.now() / 1000),
  )
  return renderPage(c, notificationsTitle(lang), notificationsBody(items, lang))
})

notificationRoutes.post('/preferences', formOnly, csrf(), async (c) => {
  const owner = await currentOwner(c)
  if (!owner) return c.redirect('/settings', 303)
  const preference = preferenceSchema.safeParse(
    await c.req.parseBody({ all: true }),
  )
  if (preference.success) {
    const { kind, receive } = preference.data
    await setReceive(c.env.DB, owner.userId, kind, receive === '1')
  }
  return c.redirect('/settings#notifications', 303)
})
