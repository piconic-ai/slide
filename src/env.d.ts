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
  // "on" on a local start (PUBLIC_ORIGIN on localhost) reads Luma's feeds
  // from the local stand-in instead; see docs/dev/f33-luma-feeds.md. Never
  // set it in production.
  LUMA_FEED_MOCK?: string

  // Scope 4 (D-08): none of these has to exist. Without one, only the
  // feature behind it does nothing and the operator page says it is not set
  // up; everything else runs as before. Each is added to wrangler.jsonc, or
  // set as a secret or var, by the work that owns it, which may rename it. A
  // binding added to wrangler.jsonc is declared in worker-configuration.d.ts
  // by `wrangler types`; delete its line here then, and keep treating it as
  // possibly absent.
  //
  // Backup bucket for the stored slide files (work B).
  UPLOADS_BACKUP?: R2Bucket
  // Usage counts (work A). The dataset to write; a secret token and the
  // account id to read it back through the SQL API.
  ANALYTICS?: AnalyticsEngineDataset
  ANALYTICS_ACCOUNT_ID?: string
  ANALYTICS_READ_TOKEN?: string
  // Alerts (work M). The Discord webhook URL is a secret; the next-day mail
  // goes to this address, or to the contact address when it is unset.
  DISCORD_WEBHOOK_URL?: string
  ALERT_MAIL_TO?: string
  // Email address encryption (work C). Keys are secrets: the encryption keys
  // by version, which version encrypts new rows, and the key of the lookup
  // value.
  EMAIL_CIPHER_KEYS?: string
  EMAIL_CIPHER_CURRENT?: string
  EMAIL_LOOKUP_KEY?: string
  // "on" lets anyone sign up; anything else keeps sign-up invite-only
  // (work R).
  OPEN_SIGNUP?: string
}
