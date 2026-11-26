import { HELP_CATALOG } from '../help/default-catalog'
import { TEST_ORIGIN } from '../publication/test-support'

// The pages and answers the tests of F43 open to see that no address is in
// them. The list is the one the test of the GET routes reads (F43-AC9): a
// route that none of these reaches, and that is not a place an address may
// show (src/privacy/email-exposure.ts), fails it.

/** Every page and public answer a signed-in author or a reader meets. */
export const PAGES = [
  '/',
  '/login',
  '/help',
  '/terms',
  '/privacy',
  '/contact',
  '/my/slides',
  '/my/slides/talk',
  '/my/slides/talk/article',
  '/notifications',
  '/@owner',
  '/@owner/cited',
  '/@owner/citing',
  '/@owner/following',
  '/@owner/followers',
  '/@owner/talk',
  '/@owner/talk/1',
  '/@bob',
  '/@bob/cited',
  '/@bob/reply',
  '/embed/@owner/talk',
  `/oembed?url=${encodeURIComponent(`${TEST_ORIGIN}/@owner/talk`)}`,
  '/api/home',
  '/api/session',
  '/api/public/slides',
  '/api/slides',
  '/avatars/722500',
  '/avatars/1234',
  '/.well-known/oauth-authorization-server',
]

/** The pages the fourth scope added, and the exports of one slide. */
export const SCOPE4_PATHS = [
  '/privacy/external',
  '/help/bot',
  '/help?q=zzzz-no-such-word',
  ...HELP_CATALOG.map((entry) => entry.path),
  '/my/slides/talk/export/slide.json',
  '/my/slides/talk/export/article.md',
]

/** The rest of the pages that answer a GET, most of them with an error or a redirect. */
export const OTHER_PATHS = [
  '/robots.txt',
  '/goodbye',
  '/welcome',
  '/auth/owner',
  '/start',
  '/my/slides/new',
  '/my/communities',
  '/communities',
  '/communities/new',
  '/communities/1/logo',
  '/reports/new',
  '/mutes/new',
  '/blocks/new',
  '/follows/new',
  '/events/1',
  '/covers/none.png',
  '/covers/none/none.png',
  '/uploads/none',
  '/api/uploads/none',
  '/api/uploads/none/content/none',
  '/api/slides/talk/deployments',
  '/api/slides/talk/publication',
  '/api/public/communities',
  '/api/home/communities',
  '/api/home/following-slides',
  '/api/home/discover',
  '/account/export/picture',
  '/_offline/evict',
  '/oauth/authorize',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/__mock/luma/ics/get',
]

/** What the operator host answers, besides the invitations, which show addresses. */
export const OPERATOR_PAGES = [
  '/robots.txt',
  '/operations',
  '/metrics',
  '/metrics.csv',
]
