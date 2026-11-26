// The routes that hand a signed-in person their own data (F35). Every route
// answers only the person whose session it is, for their own slides and
// account; a slide of someone else is answered as a slide that is not there.
import { recordFrom } from '../metrics/record-routes'
import type { ExportKind } from '../metrics/events'
import { Hono, type Context } from 'hono'
import { readArticle } from '../articles/store'
import { currentOwner } from '../auth/owner-middleware'
import type { Owner } from '../auth/owner-session'
import { deckTitles, notFoundBody, renderPage } from '../decks/pages'
import { waitUntilOf } from '../feeds/reader-routes'
import { langOf } from '../site/lang'
import { emailCryptoOf } from '../db/email-settings'
import { readAccountInfo } from './account-export-store'
import { articleMarkdown } from './article-text'
import {
  readExportDeck,
  readSlideInfo,
  readVersionFiles,
  type ExportDeck,
} from './deck-export-store'
import { downloadHeaders, isOwnRequest } from './download-headers'
import {
  exportRefusalBody,
  exportRefusalTitle,
  type ExportRefusal,
} from './export-pages'
import { acquireZipLease } from './lease-store'
import { readPictureObject } from '../profile/picture-store'
import { jsonText } from './slide-info'
import { versionZip } from './zip-source-store'
import { zipFileName } from './zip-name'

export const exportRoutes = new Hono<{ Bindings: Env }>()

type ExportContext = Context<{ Bindings: Env }>
const now = () => Math.floor(Date.now() / 1000)

/** The files a slide offers, as the last segment of their address. */
const SLIDE_FILES = [
  'published.zip',
  'prepared.zip',
  'article.md',
  'slide.json',
] as const
type SlideFile = (typeof SLIDE_FILES)[number]
const slideFileOf = (name: string): SlideFile | null =>
  SLIDE_FILES.find((file) => file === name) ?? null

/**
 * Who asks: the signed-in owner, or the answer to give instead. A request
 * another site caused is refused before anything is read. Someone who is not
 * signed in is sent to sign in. A suspended person is refused by
 * `currentOwner`, which throws what the app answers with the suspension page.
 */
async function ownerOf(c: ExportContext): Promise<Owner | Response> {
  if (
    !isOwnRequest(
      c.req.header('Sec-Fetch-Site'),
      c.req.header('Sec-Fetch-Dest'),
    )
  )
    return c.text('Forbidden', 403, { 'Cache-Control': 'no-store' })
  const owner = await currentOwner(c)
  if (!owner) {
    c.header('Cache-Control', 'no-store')
    return c.redirect('/login', 303)
  }
  return owner
}

/** The page that stands for a slide that is not there, whoever's it is. */
const slideNotFound = (c: ExportContext) => {
  const lang = langOf(c)
  return renderPage(c, deckTitles(lang).notFoundTitle, notFoundBody(lang), 404)
}

const REFUSAL_STATUS = { busy: 429, too_large: 413, unavailable: 503 } as const

function refusal(
  c: ExportContext,
  kind: ExportRefusal,
  back: string,
  retryAfter?: number,
) {
  const lang = langOf(c)
  if (retryAfter !== undefined) c.header('Retry-After', String(retryAfter))
  return renderPage(
    c,
    exportRefusalTitle(lang, kind),
    exportRefusalBody(lang, kind, back),
    REFUSAL_STATUS[kind],
  )
}

async function zipOf(
  c: ExportContext,
  owner: Owner,
  deck: ExportDeck,
  role: 'published' | 'prepared',
) {
  const version = deck.versions[role]
  if (!version) return slideNotFound(c)
  const back = `/slides/${deck.slug}`
  const read = await readVersionFiles(c.env.DB, {
    ownerUserId: owner.userId,
    deckId: deck.id,
    version,
  })
  if (read.kind === 'missing') return slideNotFound(c)
  // A HEAD asks for the headers only: no stream is read, so none would give
  // the lease back.
  if (c.req.method === 'HEAD')
    return new Response(null, {
      headers: downloadHeaders({
        contentType: 'application/zip',
        fileName: zipFileName({
          slug: deck.slug,
          deploymentId: version.deploymentId,
          readyAt: version.readyAt,
        }),
      }),
    })
  const lease = await acquireZipLease(c.env.UPLOADS, owner.userId, now())
  if (lease.kind === 'invalid_user') return refusal(c, 'unavailable', back)
  if (lease.kind === 'busy') return refusal(c, 'busy', back, lease.retryAfter)
  const release = () => lease.release().catch(() => undefined)
  const waitUntil = waitUntilOf(c)
  const zip = versionZip(c.env.UPLOADS, read, () => {
    // The stream is done or gone; the request may end before R2 answers, so
    // the release is handed to the runtime to finish.
    const released = release()
    if (waitUntil) waitUntil(released)
  })
  if (zip.kind !== 'zip') {
    await release()
    return refusal(c, zip.kind, back)
  }
  return new Response(zip.stream, {
    headers: downloadHeaders({
      contentType: 'application/zip',
      fileName: zipFileName({
        slug: deck.slug,
        deploymentId: version.deploymentId,
        readyAt: version.readyAt,
      }),
      length: zip.length,
    }),
  })
}

async function articleOf(c: ExportContext, deck: ExportDeck) {
  const article = await readArticle(c.env.DB, deck.id)
  if (!article) return slideNotFound(c)
  return new Response(articleMarkdown(article), {
    headers: downloadHeaders({
      contentType: 'text/markdown; charset=utf-8',
      fileName: `${deck.slug}.md`,
    }),
  })
}

async function infoOf(c: ExportContext, owner: Owner, deck: ExportDeck) {
  const info = await readSlideInfo(c.env.DB, {
    ownerUserId: owner.userId,
    deck,
    origin: c.env.PUBLIC_ORIGIN,
    now: now(),
  })
  return new Response(jsonText(info), {
    headers: downloadHeaders({
      contentType: 'application/json; charset=utf-8',
      fileName: `${deck.slug}.json`,
    }),
  })
}

exportRoutes.get('/slides/:deck/export/:file', async (c) => {
  const file = slideFileOf(c.req.param('file'))
  const owner = await ownerOf(c)
  if (owner instanceof Response) return owner
  const deck = await readExportDeck(c.env.DB, owner.userId, c.req.param('deck'))
  if (!deck || file === null) return slideNotFound(c)
  const answered = (what: ExportKind, response: Response | Promise<Response>) =>
    Promise.resolve(response).then((made) => {
      // A HEAD reads nothing out, so it is no download.
      if (made.ok && c.req.method === 'GET')
        recordFrom(c, { name: 'export_downloaded', what })
      return made
    })
  switch (file) {
    case 'published.zip':
      return answered('slide', zipOf(c, owner, deck, 'published'))
    case 'prepared.zip':
      return answered('slide', zipOf(c, owner, deck, 'prepared'))
    case 'article.md':
      return answered('article', articleOf(c, deck))
    case 'slide.json':
      return answered('info', infoOf(c, owner, deck))
  }
})

exportRoutes.get('/account/export/account.json', async (c) => {
  const owner = await ownerOf(c)
  if (owner instanceof Response) return owner
  const info = await readAccountInfo(c.env.DB, {
    userId: owner.userId,
    origin: c.env.PUBLIC_ORIGIN,
    now: now(),
    email: emailCryptoOf(c.env),
  })
  if (!info) return slideNotFound(c)
  recordFrom(c, { name: 'export_downloaded', what: 'account' })
  return new Response(jsonText(info), {
    headers: downloadHeaders({
      contentType: 'application/json; charset=utf-8',
      fileName: `${owner.login}.json`,
    }),
  })
})

exportRoutes.get('/account/export/picture', async (c) => {
  const owner = await ownerOf(c)
  if (owner instanceof Response) return owner
  const picture = await readPictureObject(c.env.UPLOADS, owner.userId)
  if (!picture) return slideNotFound(c)
  recordFrom(c, { name: 'export_downloaded', what: 'picture' })
  return new Response(picture.body, {
    headers: downloadHeaders({
      // The service keeps only PNGs it made itself (F28-AC93).
      contentType: 'image/png',
      fileName: `${owner.login}.png`,
      length: picture.size,
    }),
  })
})
