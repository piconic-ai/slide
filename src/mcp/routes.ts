import { Hono } from 'hono'
import { oauthRoutes } from './oauth-routes'

/** Everything agents reach over MCP: the server and its authorization. */
export const mcpRoutes = new Hono<{ Bindings: Env }>()
mcpRoutes.route('/', oauthRoutes)
