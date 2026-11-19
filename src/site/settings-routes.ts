import { Hono } from 'hono'
import { currentOwner } from '../auth/owner-middleware'
import { accountTitles, renderPage, signInPrompt } from '../decks/pages'
import { listFollowing } from '../follows/store'
import { readHandle } from '../share/store'
import { readProfile } from '../profile/store'
import { listMuted } from '../mutes/store'
import { readOptOuts } from '../notifications/store'
import { langOf } from './lang'
import { settingsBody, settingsTitle } from './settings-pages'

export const settingsRoutes = new Hono<{ Bindings: Env }>()

settingsRoutes.get('/settings', async (c) => {
  const owner = await currentOwner(c)
  const lang = langOf(c)
  if (!owner)
    return renderPage(
      c,
      accountTitles(lang).signInTitle,
      signInPrompt(lang),
      401,
    )
  const [handle, profile, following, muted, optOuts] = await Promise.all([
    readHandle(c.env.DB, owner.userId),
    readProfile(c.env.DB, owner.userId),
    listFollowing(c.env.DB, owner.userId),
    listMuted(c.env.DB, owner.userId),
    readOptOuts(c.env.DB, owner.userId),
  ])
  return renderPage(
    c,
    settingsTitle(lang),
    settingsBody(
      { login: owner.login, handle, profile, following, muted, optOuts },
      lang,
      new URL(c.req.url),
    ),
    200,
    undefined,
    'narrow',
  )
})
