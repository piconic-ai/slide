import { Hono } from 'hono'
import { z } from 'zod'
import { readAccessFacts } from '../preview/access-store'
import { isLang, type Lang } from '../site/i18n'
import { currentOwner } from '../auth/owner-session'
import { deckIdSchema } from '../decks/binding'
import {
  accountTitles,
  deckTitles,
  notFoundBody,
  renderPage,
  signInPrompt,
} from '../decks/pages'
import { ownsReadyDeployment } from '../preview/store'
import { langOf } from '../site/lang'
import { authorTrafficBody, authorTrafficTitle, trafficTable } from './pages'
import { listTraffic, TRAFFIC_KEPT, TRAFFIC_KEPT_PER_GROUP } from './store'
import { summarize } from './summary'

export const safetyRoutes = new Hono<{ Bindings: Env }>()

const deploymentIdSchema = z.uuid()

/**
 * Where a viewer reads the traffic table of the version it shows. The
 * language is part of the path: the `lang` parameter is a reader's choice
 * and is remembered, which reading a table must not do.
 */
export const trafficPath = (deploymentId: string, lang: Lang) =>
  `/api/public/deployments/${deploymentId}/traffic/${lang}`

/** The table of what a version's files were reported to exchange. */
export const readTrafficSummary = async (database: D1Database, id: string) =>
  summarize(await listTraffic(database, id), {
    kept: TRAFFIC_KEPT,
    keptPerGroup: TRAFFIC_KEPT_PER_GROUP,
  })

/**
 * The traffic table of a version anyone may read, as markup in the
 * language asked for. The viewer asks again each time a reader opens the table, since
 * reports arrive while slides run.
 */
safetyRoutes.get('/api/public/deployments/:id/traffic/:lang', async (c) => {
  c.header('Cache-Control', 'no-store')
  const lang = c.req.param('lang')
  const id = deploymentIdSchema.safeParse(c.req.param('id'))
  const facts =
    id.success &&
    (await readAccessFacts(c.env.DB, {
      deploymentId: id.data,
      sessionToken: null,
      allowedOwnerId: c.env.GITHUB_ACTOR_ID,
      now: Math.floor(Date.now() / 1000),
    }))
  // A draft, a stopped version and a missing one answer alike.
  if (!id.success || !isLang(lang) || !facts || !facts.isPublic)
    return c.json({ error: 'Not found' }, 404)
  return c.html(trafficTable(await readTrafficSummary(c.env.DB, id.data), lang))
})

/**
 * The same table for the author of a version, public or not. Anyone else,
 * and any version that is not a ready one of this deck, gets the page a
 * missing deck gets.
 */
safetyRoutes.get('/slides/:deck/deployments/:id/traffic', async (c) => {
  const lang = langOf(c)
  const owner = await currentOwner(c)
  if (!owner)
    return renderPage(
      c,
      accountTitles(lang).signInTitle,
      signInPrompt(lang),
      401,
    )
  const deck = deckIdSchema.safeParse(c.req.param('deck'))
  const id = deploymentIdSchema.safeParse(c.req.param('id'))
  const owned =
    deck.success &&
    id.success &&
    (await ownsReadyDeployment(c.env.DB, {
      deckId: deck.data,
      deploymentId: id.data,
      ownerUserId: owner.userId,
    }))
  if (!deck.success || !id.success || !owned)
    return renderPage(
      c,
      deckTitles(lang).notFoundTitle,
      notFoundBody(lang),
      404,
    )
  return renderPage(
    c,
    authorTrafficTitle(lang),
    authorTrafficBody(
      deck.data,
      await readTrafficSummary(c.env.DB, id.data),
      lang,
    ),
  )
})
