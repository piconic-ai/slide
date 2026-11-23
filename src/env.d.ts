// Secrets are not declared in wrangler.jsonc, so `wrangler types` cannot
// generate them. Set secrets with `wrangler secret put` or in .dev.vars
// for local development.
interface Env {
  BETTER_AUTH_SECRET?: string
  // Mail. With the three MAIL_* values below set, login codes go out through
  // Cloudflare Email Service; with MAIL_OUTBOX "on" they are written to the
  // mail_outbox table instead (local development and tests). With neither,
  // asking for a code answers 503.
  MAIL_API_TOKEN?: string
  MAIL_ACCOUNT_ID?: string
  MAIL_FROM?: string
  MAIL_OUTBOX?: string
  // Turnstile on the login page. Without the secret, the check passes.
  TURNSTILE_SITE_KEY?: string
  TURNSTILE_SECRET?: string
  // Limits on asking for login codes; see src/auth/login-policy.ts.
  LOGIN_CODE_LIMITS?: unknown
  // "on" answers every management request with 503. Toggle it with
  // `wrangler secret put MAINTENANCE` and `wrangler secret delete MAINTENANCE`.
  MAINTENANCE?: string
}
