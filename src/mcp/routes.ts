import { Hono } from 'hono'
import { connectionRoutes } from './connection-routes'
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
mcpRoutes.route('/', connectionRoutes)
