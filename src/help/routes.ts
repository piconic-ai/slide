import { Hono, type Context } from 'hono'
import { signupModeOf, type SignupMode } from '../auth/signup-mode'
import { HELP_BOT_PAGE_POLICY, helpBotPage } from '../site/help-bot-page'
import { alternateLinks } from '../site/i18n'
import { recordFrom } from '../metrics/record-routes'
import { langOf } from '../site/lang'
import { isHelpAim } from './aims'
import { catalogFor, findArticle } from './catalog'
import { HELP_CATALOG } from './default-catalog'
import { helpNumbers } from './numbers'
import {
  HELP_PAGE_POLICY,
  HELP_SEARCH_PAGE_POLICY,
  helpAimPage,
  helpArticlePage,
  helpEntryPage,
  helpSearchPage,
} from './pages'
import { HELP_BOT_PATH, HELP_PATH, HELP_QUERY_PARAM } from './paths'
import {
  buildSearchIndex,
  parseQuery,
  searchHelp,
  type SearchIndex,
} from './search'

/**
 * The help's pages. They read no database and are registered before the
 * maintenance check, so they stay readable while the service is down for
 * maintenance (D-119).
 */
export const helpRoutes = new Hono<{ Bindings: Env }>()

/** What a reader of one mode is shown: the articles, the numbers, the index. */
type View = Readonly<{
  catalog: ReturnType<typeof catalogFor>
  numbers: ReturnType<typeof helpNumbers>
  index: () => Promise<SearchIndex>
}>

// The articles do not change while the Worker runs, and the setting that
// tells the modes apart is a deploy-time value, so each mode's view is built
// once, when it is first asked for, and kept. No database is read.
const views = new Map<SignupMode, View>()
function viewOf(c: Context<{ Bindings: Env }>): View {
  const mode = signupModeOf(c.env.OPEN_SIGNUP)
  const known = views.get(mode)
  if (known) return known
  const catalog = catalogFor(HELP_CATALOG, mode)
  const numbers = helpNumbers(mode)
  let index: Promise<SearchIndex> | undefined
  const made: View = {
    catalog,
    numbers,
    index: () => (index ??= buildSearchIndex(catalog, numbers)),
  }
  views.set(mode, made)
  return made
}

const pageHeaders = (origin: string, url: URL, policy: string) => ({
  'Content-Security-Policy': policy,
  Link: alternateLinks(origin, url),
})

helpRoutes.get(HELP_PATH, async (c) => {
  const url = new URL(c.req.url)
  const lang = langOf(c)
  const query = parseQuery(c.req.query(HELP_QUERY_PARAM))
  const view = viewOf(c)
  if (query.kind === 'empty')
    return c.html(
      helpEntryPage(lang, url, view.catalog),
      200,
      pageHeaders(c.env.PUBLIC_ORIGIN, url, HELP_SEARCH_PAGE_POLICY),
    )
  const hits = searchHelp(await view.index(), query, lang)
  // Only the words that found nothing are kept, to see what is missing.
  if (hits.length === 0)
    recordFrom(c, { name: 'help_search_empty', term: query.shown })
  // A page of results is no page to list: it is not given alternates either.
  return c.html(helpSearchPage(lang, url, query, hits), 200, {
    'Content-Security-Policy': HELP_SEARCH_PAGE_POLICY,
    'X-Robots-Tag': 'noindex',
  })
})

// The bot's page keeps its URL, which a User-Agent names (D-46); it is
// registered before the aims so that no aim path can hide it.
helpRoutes.get(HELP_BOT_PATH, (c) => {
  const url = new URL(c.req.url)
  return c.html(helpBotPage(langOf(c), url), 200, {
    'Content-Security-Policy': HELP_BOT_PAGE_POLICY,
    Link: alternateLinks(c.env.PUBLIC_ORIGIN, url),
  })
})

helpRoutes.get(`${HELP_PATH}/:aim`, async (c) => {
  const aim = c.req.param('aim')
  if (!isHelpAim(aim)) return c.notFound()
  const url = new URL(c.req.url)
  const view = viewOf(c)
  return c.html(
    await helpAimPage(langOf(c), url, aim, view.catalog, view.numbers),
    200,
    pageHeaders(c.env.PUBLIC_ORIGIN, url, HELP_PAGE_POLICY),
  )
})

helpRoutes.get(`${HELP_PATH}/:aim/:slug`, async (c) => {
  const view = viewOf(c)
  const entry = findArticle(
    view.catalog,
    c.req.param('aim'),
    c.req.param('slug'),
  )
  if (!entry) return c.notFound()
  recordFrom(c, {
    name: 'help_article_viewed',
    article: `${c.req.param('aim')}/${c.req.param('slug')}`,
  })
  const url = new URL(c.req.url)
  return c.html(
    await helpArticlePage(langOf(c), url, entry, view.catalog, view.numbers),
    200,
    pageHeaders(c.env.PUBLIC_ORIGIN, url, HELP_PAGE_POLICY),
  )
})
