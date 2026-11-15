import { Hono } from 'hono'
import { currentOwner } from '../auth/owner-session'
import { accountTitles, renderPage, signInPrompt } from '../decks/pages'
import { readHandle } from '../share/store'
import { readProfile } from '../profile/store'
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
  const [handle, profile] = await Promise.all([
    readHandle(c.env.DB, owner.userId),
    readProfile(c.env.DB, owner.userId),
  ])
  return renderPage(
    c,
    settingsTitle(lang),
    settingsBody({ login: owner.login, handle, profile }, lang),
  )
})
