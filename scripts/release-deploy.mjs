#!/usr/bin/env node
// The deploy command of Workers Builds for the production Worker: it records
// where the database is, applies the migrations, deploys, and checks the
// release, and it stops at the first step that fails (docs/dev/release-flow.md).
// The build command has already built the files; this does not build.
//
//   node scripts/release-deploy.mjs [--database slide] [--site URL]
//     [--content-origin URL] [--admin-origin URL] [--wrangler PATH]
//     [--allow-outside-ci]
//
// The origins default to PUBLIC_ORIGIN, CONTENT_ORIGIN and OPERATOR_ORIGIN of
// wrangler.jsonc. DISCORD_WEBHOOK_URL, a build variable, is where a failure is
// told; without it nothing is sent and the exit code still says it failed.
// Exit codes: 0 released, 1 a step failed, 2 refused or misused (nothing ran).
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import {
  CHECK_TIMEOUT_MS,
  limitTime,
  NOTICE_TIMEOUT_MS,
} from './release-fetch.mjs'
import { parseOrigin, runPostDeployChecks } from './post-deploy-checks.mjs'
import { tell } from './discord-notice.mjs'
import {
  parseArgs,
  redacted,
  refusal,
  varsOfWranglerConfig,
} from './release-options.mjs'
import { runRelease } from './release-steps.mjs'

const DEFAULT_WRANGLER = 'node_modules/.bin/wrangler'
/** What a child process may not inherit: the webhook is for this script alone. */
const WITHHELD = ['DISCORD_WEBHOOK_URL']

function runWrangler(binary, args, env, secrets) {
  const childEnv = { ...env }
  for (const name of WITHHELD) delete childEnv[name]
  return new Promise((resolve) => {
    execFile(
      binary,
      args,
      { env: childEnv, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        process.stdout.write(redacted(stdout, secrets))
        process.stderr.write(redacted(stderr, secrets))
        // A signal or a missing binary has no numeric code: it is a failure.
        resolve({
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          stdout,
        })
      },
    )
  })
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed) {
    console.error(
      'usage: node scripts/release-deploy.mjs [--database NAME] [--site URL] [--content-origin URL] [--admin-origin URL] [--wrangler PATH] [--allow-outside-ci]',
    )
    return 2
  }
  const { options, flags } = parsed
  const refused = refusal(process.env, flags)
  if (refused) {
    console.error(`refused: ${refused}`)
    return 2
  }
  const vars = varsOfWranglerConfig(await readFile('wrangler.jsonc', 'utf8'))
  const origins = {
    site: parseOrigin(options.site ?? vars.PUBLIC_ORIGIN),
    content: parseOrigin(options['content-origin'] ?? vars.CONTENT_ORIGIN),
    admin: parseOrigin(options['admin-origin'] ?? vars.OPERATOR_ORIGIN),
  }
  if (!origins.site || !origins.content || !origins.admin) {
    console.error('refused: an origin to check is missing or is not an origin')
    return 2
  }
  const webhook = process.env.DISCORD_WEBHOOK_URL
  const secrets = [webhook, process.env.CLOUDFLARE_API_TOKEN]
  const log = (line) => console.log(redacted(line, secrets))
  const binary = options.wrangler ?? DEFAULT_WRANGLER

  const outcome = await runRelease({
    run: (args) => runWrangler(binary, args, process.env, secrets),
    check: () =>
      runPostDeployChecks(origins, limitTime(fetch, CHECK_TIMEOUT_MS)),
    tell: (text) =>
      tell(webhook, text, limitTime(fetch, NOTICE_TIMEOUT_MS), log),
    log,
    database: options.database ?? 'slide',
    commit: process.env.WORKERS_CI_COMMIT_SHA,
  })
  return outcome.ok ? 0 : 1
}

process.exitCode = await main()
