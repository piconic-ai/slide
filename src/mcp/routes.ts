import { Hono } from 'hono'
import { oauthConsentRoutes } from './oauth-consent-routes'
import { oauthRoutes } from './oauth-routes'
import { previewLinkRoutes } from './preview-routes'
import { mcpServerRoutes } from './server-routes'

/** Everything agents reach over MCP: the server and its authorization. */
export const mcpRoutes = new Hono<{ Bindings: Env }>()
mcpRoutes.route('/', oauthRoutes)
mcpRoutes.route('/', oauthConsentRoutes)
mcpRoutes.route('/', mcpServerRoutes)
mcpRoutes.route('/', previewLinkRoutes)
