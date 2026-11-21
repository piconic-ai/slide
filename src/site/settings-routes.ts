import { Hono, type Context } from 'hono'
import { csrf } from 'hono/csrf'
import { currentOwner } from '../auth/owner-middleware'
import type { Owner } from '../auth/owner-session'
import { accountTitles, renderPage, signInPrompt } from '../decks/pages'
import { listConnections } from '../mcp/connections-store'
import { mcpResource } from '../mcp/oauth-metadata'
import { readHandle } from '../share/store'
import {
  checkProfile,
  fieldsOfForm,
  type ProfileFields,
  type ProfileProblem,
} from '../profile/profile-input'
import {
  readEmail,
  readProfile,
  saveProfile,
  type StoredProfile,
} from '../profile/store'
import { listMuted } from '../mutes/store'
import { readOptOuts } from '../notifications/store'
import { langOf } from './lang'
import { settingsBody, settingsTitle } from './settings-pages'

export const settingsRoutes = new Hono<{ Bindings: Env }>()

type FormState = Readonly<{
  fields: ProfileFields
  problems: readonly ProfileProblem[]
  saved: boolean
}>

/** The form as it opens: what the author saved, or empty before they did. */
const savedFields = (profile: StoredProfile | null): ProfileFields => ({
  name: profile?.name ?? '',
  bio: profile?.bio ?? '',
  location: profile?.location ?? '',
  website: profile?.website ?? '',
  links: profile?.links ?? [],
  useGravatar: profile?.useGravatar ?? true,
})

/** Draws the settings page. `form` says what the profile frame shows. */
async function settingsPage(
  c: Context<{ Bindings: Env }>,
  owner: Owner,
  form: (profile: StoredProfile | null) => FormState,
  status: 200 | 400,
) {
  const lang = langOf(c)
  const [handle, email, profile, muted, optOuts, connections] =
    await Promise.all([
      readHandle(c.env.DB, owner.userId),
      readEmail(c.env.DB, owner.userId),
      readProfile(c.env.DB, owner.userId),
      listMuted(c.env.DB, owner.userId),
      readOptOuts(c.env.DB, owner.userId),
      listConnections(c.env.DB, owner.userId, Math.floor(Date.now() / 1000)),
    ])
  return renderPage(
    c,
    settingsTitle(lang),
    settingsBody(
      {
        login: owner.login,
        // Whoever has an owner session has an account, so both exist.
        handle: handle ?? owner.login,
        email: email ?? '',
        profileForm: form(profile),
        muted,
        optOuts,
        agents: { mcpUrl: mcpResource(c.env.PUBLIC_ORIGIN), connections },
      },
      lang,
      new URL(c.req.url),
    ),
    status,
    undefined,
    'narrow',
  )
}

const signedOutPage = (c: Context<{ Bindings: Env }>) => {
  const lang = langOf(c)
  return renderPage(c, accountTitles(lang).signInTitle, signInPrompt(lang), 401)
}

settingsRoutes.get('/settings', async (c) => {
  const owner = await currentOwner(c)
  if (!owner) return signedOutPage(c)
  return settingsPage(
    c,
    owner,
    (profile) => ({
      fields: savedFields(profile),
      problems: [],
      saved: c.req.query('saved') === 'profile',
    }),
    200,
  )
})

settingsRoutes.post('/settings/profile', csrf(), async (c) => {
  const owner = await currentOwner(c)
  if (!owner) return signedOutPage(c)
  const body = await c.req.parseBody({ all: true })
  const current = await readProfile(c.env.DB, owner.userId)
  const fields = fieldsOfForm(body, current?.useGravatar ?? true)
  const check = checkProfile(fields)
  if (check.kind === 'invalid')
    return settingsPage(
      c,
      owner,
      () => ({ fields, problems: check.problems, saved: false }),
      400,
    )
  await saveProfile(c.env.DB, owner.userId, check.profile)
  return c.redirect('/settings?saved=profile#profile', 303)
})
