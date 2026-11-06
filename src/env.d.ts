// Secrets are not declared in wrangler.jsonc, so `wrangler types` cannot
// generate them. Set GITHUB_APP_CLIENT_SECRET with `wrangler secret put` or
// in .dev.vars for local development.
interface Env {
  GITHUB_APP_CLIENT_SECRET?: string
}
