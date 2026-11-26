import { Hono } from 'hono'
import { HELP_BOT_PAGE_POLICY, helpBotPage } from '../site/help-bot-page'
import { alternateLinks } from '../site/i18n'
import { langOf } from '../site/lang'
import { isHelpAim } from './aims'
import { findArticle } from './catalog'
import { HELP_CATALOG } from './default-catalog'
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

// The index is built from the article files, which do not change while the
// Worker runs, so it is built once and kept.
let index: Promise<SearchIndex> | undefined
const searchIndex = () => (index ??= buildSearchIndex(HELP_CATALOG))

const pageHeaders = (origin: string, url: URL, policy: string) => ({
  'Content-Security-Policy': policy,
  Link: alternateLinks(origin, url),
})

helpRoutes.get(HELP_PATH, async (c) => {
  const url = new URL(c.req.url)
  const lang = langOf(c)
  const query = parseQuery(c.req.query(HELP_QUERY_PARAM))
  if (query.kind === 'empty')
    return c.html(
      helpEntryPage(lang, url, HELP_CATALOG),
      200,
      pageHeaders(c.env.PUBLIC_ORIGIN, url, HELP_SEARCH_PAGE_POLICY),
    )
  const hits = searchHelp(await searchIndex(), query, lang)
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
  return c.html(
    await helpAimPage(langOf(c), url, aim, HELP_CATALOG),
    200,
    pageHeaders(c.env.PUBLIC_ORIGIN, url, HELP_PAGE_POLICY),
  )
})

helpRoutes.get(`${HELP_PATH}/:aim/:slug`, async (c) => {
  const entry = findArticle(
    HELP_CATALOG,
    c.req.param('aim'),
    c.req.param('slug'),
  )
  if (!entry) return c.notFound()
  const url = new URL(c.req.url)
  return c.html(
    await helpArticlePage(langOf(c), url, entry, HELP_CATALOG),
    200,
    pageHeaders(c.env.PUBLIC_ORIGIN, url, HELP_PAGE_POLICY),
  )
})
