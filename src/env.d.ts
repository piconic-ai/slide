// Secrets are not declared in wrangler.jsonc, so `wrangler types` cannot
// generate them. Set secrets with `wrangler secret put` or in .dev.vars
// for local development.
interface Env {
  BETTER_AUTH_SECRET?: string
  GITHUB_APP_CLIENT_SECRET?: string
  // "on" answers every management request with 503. Toggle it with
  // `wrangler secret put MAINTENANCE` and `wrangler secret delete MAINTENANCE`.
  MAINTENANCE?: string
  // The Cloudflare Access team domain and the operator application's
  // audience tag. Until both are set, the operator host answers every
  // request as missing. Neither is a secret.
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
}
