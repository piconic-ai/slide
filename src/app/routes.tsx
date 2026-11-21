import { Hono } from 'hono'
import { authRoutes } from '../auth/routes'
import { loginRoutes } from '../auth/login-routes'
import { welcomeFirst } from '../auth/welcome-middleware'
import { SuspendedOwnerError } from '../auth/owner-middleware'
import {
  SUSPENSION_PAGE_POLICY,
  suspensionPage,
} from '../auth/suspension-pages'
import { accountForms } from '../decks/account-routes'
import { deckApi, deckForms } from '../decks/routes'
import { publicationApi, publicationForms } from '../publication/routes'
import { contentBaseOf } from '../preview/config'
import { routeOfHost } from '../preview/origin'
import { privateHeaders } from '../preview/pages'
import { contentApp } from '../preview/content'
import { sweepPreviews } from '../preview/store'
import { deckUploadsApi, uploadsApi } from '../uploads/api'
import { describeCleanupError } from '../uploads/cleanup'
import { runUploadCleanup } from '../uploads/cleanup-store'
import { purgeDelaySeconds, purgeDeletedDecks } from '../decks/deletion-store'
import { parseUploadLimits } from '../uploads/limits'
import { statusPage } from '../uploads/status-page'
import { HELP_PAGE_POLICY, HELP_PATH, helpPage } from '../site/help-page'
import {
  LEGAL_PAGE_POLICY,
  legalKinds,
  legalPage,
  legalPath,
} from '../site/legal-pages'
import { shareRoutes } from '../share/routes'
import { embedRoutes } from '../embed/routes'
import { coverRoutes } from '../covers/routes'
import { reportForms } from '../reports/routes'
import { muteForms } from '../mutes/routes'
import { followForms } from '../follows/routes'
import { notificationRoutes } from '../notifications/routes'
import { isHomeAssetPath } from '../site/home-assets'
import { homeRoutes } from '../site/home-routes'
import { faceRoutes } from '../profile/face-routes'
import { settingsRoutes } from '../site/settings-routes'
import { mcpRoutes } from '../mcp/routes'
import { startRoutes } from '../site/start-routes'
import {
  noBodyRewrite,
  noindexPrivate,
  robotsTxt,
  siteHeaders,
} from '../site/middleware'
import { siteFooter } from '../site/footer'
import { siteHeader } from '../site/header'
import { pageStyle } from '../site/page-style'
import { alternateLinks } from '../site/i18n'
import { langMiddleware, langOf } from '../site/lang'
import { rateLimit, withinLimit } from '../site/rate-limit'
import { RETRY_AFTER_SECONDS } from '../site/rate-limit-policy'
import { maintenance, notFound, onError } from '../site/errors'
import { isOperatorHost } from '../operator/config'
import { operatorApp, operatorConfigOf } from '../operator/routes'
import {
  isMaintenance,
  MAINTENANCE_RETRY_AFTER_SECONDS,
} from '../site/error-pages'

export const app = new Hono<{ Bindings: Env }>()
app.use(siteHeaders, noindexPrivate, noBodyRewrite, ...langMiddleware)
app.notFound(notFound)
app.onError((error, c) => {
  if (!(error instanceof SuspendedOwnerError)) return onError(error, c)
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  if (c.req.path.startsWith('/api/'))
    return c.json({ error: 'Account suspended' }, 403)
  c.header('Content-Security-Policy', SUSPENSION_PAGE_POLICY)
  return c.html(
    suspensionPage(
      error.owner.login,
      error.suspension,
      langOf(c),
      new URL(c.req.url),
    ),
    403,
  )
})
// Crawlers read a 5xx robots.txt as a full disallow, so it stays up.
app.get('/robots.txt', robotsTxt)
// The terms, the contact point and the help stay readable during maintenance.
for (const kind of legalKinds)
  app.get(legalPath(kind), (c) =>
    c.html(legalPage(kind, langOf(c), new URL(c.req.url)), 200, {
      'Content-Security-Policy': LEGAL_PAGE_POLICY,
    }),
  )
app.get(HELP_PATH, (c) => {
  const url = new URL(c.req.url)
  return c.html(helpPage(langOf(c), url), 200, {
    'Content-Security-Policy': HELP_PAGE_POLICY,
    Link: alternateLinks(c.env.PUBLIC_ORIGIN, url),
  })
})
app.use(maintenance, rateLimit)
app.use(welcomeFirst)
app.route('/api/uploads', uploadsApi)
app.route('/auth', authRoutes)
app.route('/', loginRoutes)
app.route('/account', accountForms)
app.route('/slides', deckForms)
app.route('/slides', publicationForms)
app.route('/reports', reportForms)
app.route('/mutes', muteForms)
app.route('/follows', followForms)
app.route('/notifications', notificationRoutes)
app.route('/api/slides', deckApi)
app.route('/api/slides', deckUploadsApi)
app.route('/api/slides', publicationApi)
app.route('/', shareRoutes)
app.route('/', coverRoutes)
app.route('/', homeRoutes)
app.route('/', startRoutes)
app.route('/', settingsRoutes)
app.route('/', faceRoutes)
app.route('/', embedRoutes)
app.route('/', mcpRoutes)
app.get('/uploads/:id', async (c) => {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  const lang = langOf(c)
  const [style, header, footer] = await Promise.all([
    pageStyle,
    siteHeader(lang),
    siteFooter(lang, new URL(c.req.url)),
  ])
  return c.html(
    statusPage(lang, {
      style: String(style),
      header: `<script src="/share.js" defer></script>${header}`,
      footer: String(footer),
    }),
  )
})

/**
 * The service's own static files exist on the management host only. The
 * Worker runs before them, so a deployment origin serves the author's
 * `/styles.css`, not the service's.
 */
async function managementFetch(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
) {
  // The top page is a static file too, but the app serves it with the
  // page headers; see homeRoutes.
  const { pathname } = new URL(request.url)
  const isHome = isHomeAssetPath(pathname)
  if (!isHome && (request.method === 'GET' || request.method === 'HEAD')) {
    // Browsers ask for /favicon.ico on pages without an icon link; the
    // service's icon is an SVG, sent under its own type.
    if (pathname === '/favicon.ico')
      request = new Request(new URL('/favicon.svg', request.url), request)
    // A failing lookup falls through, so the app's error handling answers.
    const asset = await env.ASSETS.fetch(request).catch(() => null)
    if (asset && asset.status !== 404) return asset
  }
  return app.fetch(request, env, ctx)
}

/**
 * A deployment origin's request, counted against the per-IP content budget
 * before authorization reads D1.
 */
async function contentFetch(
  deploymentId: string,
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
) {
  if (!(await withinLimit(env, 'content', request)))
    return new Response('Too many requests; retry later', {
      status: 429,
      headers: {
        ...privateHeaders,
        'Retry-After': String(RETRY_AFTER_SECONDS),
      },
    })
  return contentApp(deploymentId, ctx?.exports?.ContentFiles ?? null).fetch(
    request,
    env,
    ctx,
  )
}

/**
 * Requests on the content domain never reach the management app: a
 * deployment origin gets only its content routes, anything else 404.
 * Requests on the operator host reach only the operator app.
 * Maintenance stops content delivery too, so nothing reads D1 meanwhile.
 */
function fetch(request: Request, env: Env, ctx?: ExecutionContext) {
  const url = new URL(request.url)
  const operator = operatorConfigOf(env)
  const onOperatorHost = isOperatorHost(operator, url)
  const route = routeOfHost(contentBaseOf(env), env.PUBLIC_ORIGIN, url)
  if (
    (onOperatorHost || route.kind !== 'management') &&
    isMaintenance(env.MAINTENANCE)
  )
    return new Response('Under maintenance', {
      status: 503,
      headers: {
        ...privateHeaders,
        'Retry-After': String(MAINTENANCE_RETRY_AFTER_SECONDS),
      },
    })
  // The operator host answers with the operator app only; no other app's
  // route is reachable on it, and its routes exist on no other host.
  if (operator && onOperatorHost)
    return operatorApp(operator).fetch(request, env, ctx)
  switch (route.kind) {
    case 'management':
      return managementFetch(request, env, ctx)
    case 'deployment':
      return contentFetch(route.deploymentId, request, env, ctx)
    case 'content_other':
      return new Response('Not found', { status: 404, headers: privateHeaders })
  }
}

export default {
  fetch,
  scheduled(event, env, ctx) {
    // Sweeps write D1 and R2, so they wait while maintenance holds the data.
    if (isMaintenance(env.MAINTENANCE)) {
      console.log(JSON.stringify({ event: 'scheduled_skipped_maintenance' }))
      return
    }
    const at = Math.floor(event.scheduledTime / 1000)
    ctx.waitUntil(
      sweepPreviews(env.DB, at).catch((error: unknown) =>
        console.error(
          JSON.stringify({
            event: 'preview_sweep_error',
            name: error instanceof Error ? error.name : 'unknown',
          }),
        ),
      ),
    )
    ctx.waitUntil(
      runUploadCleanup(env, at).then(
        (summary) =>
          console.log(JSON.stringify({ event: 'upload_cleanup', ...summary })),
        (error: unknown) =>
          console.error(
            JSON.stringify({
              event: 'upload_cleanup_error',
              ...describeCleanupError(error),
            }),
          ),
      ),
    )
    ctx.waitUntil(
      Promise.resolve()
        .then(() =>
          purgeDeletedDecks(
            env,
            at,
            purgeDelaySeconds(parseUploadLimits(env.UPLOAD_LIMITS)),
          ),
        )
        .then(
          (summary) =>
            console.log(JSON.stringify({ event: 'deck_purge', ...summary })),
          (error: unknown) =>
            console.error(
              JSON.stringify({
                event: 'deck_purge_error',
                ...describeCleanupError(error),
              }),
            ),
        ),
    )
  },
} satisfies ExportedHandler<Env>
