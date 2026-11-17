import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { currentOwner } from '../auth/owner-session'
import { renderPage } from '../decks/pages'
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
  return {
    handle: path.handle,
    slug: path.slug,
    slide: sharePath(
      path.handle,
      path.slug,
      path.kind === 'page' ? path.page : undefined,
    ),
  }
}

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
  const body =
    c.req.query('result') === 'received'
      ? reportReceivedBody(target.slide, lang)
      : reportFormBody(
          { slide: target.slide, reason: '', note: '', error: null },
          lang,
        )
  return renderPage(c, title, body)
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
          reason: typeof form.reason === 'string' ? form.reason : '',
          note: typeof form.note === 'string' ? form.note : '',
          error: parsed.kind,
        },
        lang,
      ),
      400,
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
