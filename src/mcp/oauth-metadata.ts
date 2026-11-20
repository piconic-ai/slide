/** The one scope a connection has: putting up and replacing slides. */
export const MCP_SCOPE = 'slides:upload'

export const MCP_PATH = '/mcp'
export const AUTHORIZE_PATH = '/oauth/authorize'
export const TOKEN_PATH = '/oauth/token'
export const REGISTER_PATH = '/oauth/register'
/** Where RFC 9728 puts the metadata of a resource at `/mcp`. */
export const RESOURCE_METADATA_PATH =
  '/.well-known/oauth-protected-resource/mcp'
/** The same document at the root, for clients that look only there. */
export const ROOT_RESOURCE_METADATA_PATH =
  '/.well-known/oauth-protected-resource'
export const SERVER_METADATA_PATH = '/.well-known/oauth-authorization-server'

const at = (origin: string, path: string) => new URL(path, origin).href

/**
 * The MCP server as OAuth names it: the identifier tokens are issued for
 * (RFC 8707). `origin` is the service's configured origin, never the host
 * a request names.
 */
export const mcpResource = (origin: string) => at(origin, MCP_PATH)

/** The authorization server's identifier: the origin, without a slash. */
export const issuerOf = (origin: string) => new URL(origin).origin

/** OAuth 2.0 Protected Resource Metadata (RFC 9728) of the MCP server. */
export const resourceMetadata = (origin: string) => ({
  resource: mcpResource(origin),
  authorization_servers: [issuerOf(origin)],
  bearer_methods_supported: ['header'],
  scopes_supported: [MCP_SCOPE],
})

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414). Clients are public
 * and prove themselves with PKCE; nothing but S256 is accepted.
 */
export const serverMetadata = (origin: string) => ({
  issuer: issuerOf(origin),
  authorization_endpoint: at(origin, AUTHORIZE_PATH),
  token_endpoint: at(origin, TOKEN_PATH),
  registration_endpoint: at(origin, REGISTER_PATH),
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  scopes_supported: [MCP_SCOPE],
  authorization_response_iss_parameter_supported: true,
})
