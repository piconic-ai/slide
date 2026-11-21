import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { currentOwner } from '../auth/owner-middleware'
import { embedPath } from '../embed/code'
import { PAGE_POLICY, renderPage } from '../decks/pages'
import { parseSharePath, sharePath } from '../share/path'
import { readSharedDeployment } from '../share/store'
import { langOf } from '../site/lang'
import {
  reportFormBody,
  reportReceivedBody,
  reportSignInBody,
  reportTitle,
} from './pages'
import { parseReport } from './report'
import { saveReport } from './store'

export const reportForms = new Hono<{ Bindings: Env }>()

const targetOf = (input: unknown) => {
  if (typeof input !== 'string') return null
  const path = parseSharePath(input)
  if (path.kind !== 'deck' && path.kind !== 'page') return null
  const page = path.kind === 'page' ? path.page : undefined
  return {
    handle: path.handle,
    slug: path.slug,
    slide: sharePath(path.handle, path.slug, page),
    embed: embedPath(path.handle, path.slug, page),
  }
}

/**
 * The page's own policy, plus a frame for this service's own embed page:
 * the slides being reported. No author's origin is named here; the embed
 * page frames those under its own policy.
 */
const REPORT_PAGE_POLICY = `${PAGE_POLICY}; frame-src 'self'`

reportForms.get('/new', async (c) => {
  const target = targetOf(c.req.query('slide'))
  if (!target) return c.notFound()
  const lang = langOf(c)
  const title = reportTitle(lang)
  const owner = await currentOwner(c)
  if (!owner)
    return renderPage(c, title, reportSignInBody(target.slide, lang), 401)
  const shared = await readSharedDeployment(
    c.env.DB,
    target.handle,
    target.slug,
  )
  if (!shared) return c.notFound()
  const received = c.req.query('result') === 'received'
  const body = received
    ? reportReceivedBody(target.slide, lang)
    : reportFormBody(
        {
          slide: target.slide,
          embed: target.embed,
          reason: '',
          note: '',
          error: null,
        },
        lang,
      )
  return renderPage(
    c,
    title,
    body,
    200,
    received ? PAGE_POLICY : REPORT_PAGE_POLICY,
  )
})

reportForms.post('/', csrf(), async (c) => {
  const form = await c.req.parseBody({ all: true })
  const target = targetOf(form.slide)
  if (!target) return c.notFound()
  const lang = langOf(c)
  const title = reportTitle(lang)
  const owner = await currentOwner(c)
  if (!owner)
    return renderPage(c, title, reportSignInBody(target.slide, lang), 401)
  const shared = await readSharedDeployment(
    c.env.DB,
    target.handle,
    target.slug,
  )
  if (!shared) return c.notFound()
  const parsed = parseReport({ reason: form.reason, note: form.note })
  if (parsed.kind !== 'valid')
    return renderPage(
      c,
      title,
      reportFormBody(
        {
          slide: target.slide,
          embed: target.embed,
          reason: typeof form.reason === 'string' ? form.reason : '',
          note: typeof form.note === 'string' ? form.note : '',
          error: parsed.kind,
        },
        lang,
      ),
      400,
      REPORT_PAGE_POLICY,
    )
  await saveReport(c.env.DB, {
    deckId: shared.deckId,
    deploymentId: shared.id,
    sharePath: target.slide,
    reason: parsed.reason,
    note: parsed.note,
    reporterUserId: owner.userId,
    now: Math.floor(Date.now() / 1000),
  })
  return c.redirect(
    `/reports/new?slide=${encodeURIComponent(target.slide)}&result=received`,
    303,
  )
})
