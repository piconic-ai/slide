#!/usr/bin/env node
// Runs the checks that follow a release against the origins given, by hand:
// after a rollback, or against a local start. It sends only GET requests to
// those origins. Exit codes: 0 every check passed or was skipped, 1 a check
// failed, 2 misused (nothing was asked).
//
//   node scripts/post-deploy-check.mjs [--site URL] [--content-origin URL]
//     [--admin-origin URL]
//
// An origin left out is PUBLIC_ORIGIN, CONTENT_ORIGIN or OPERATOR_ORIGIN of
// wrangler.jsonc. See docs/dev/release-flow.md (REL-AC8, REL-AC9).
import { readFile } from 'node:fs/promises'
import { CHECK_TIMEOUT_MS, limitTime } from './release-fetch.mjs'
import {
  checkLines,
  failedChecks,
  parseOrigin,
  runPostDeployChecks,
} from './post-deploy-checks.mjs'
import { parseArgs, varsOfWranglerConfig } from './release-options.mjs'

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed || parsed.flags.size > 0) {
    console.error(
      'usage: node scripts/post-deploy-check.mjs [--site URL] [--content-origin URL] [--admin-origin URL]',
    )
    return 2
  }
  const { options } = parsed
  const vars = varsOfWranglerConfig(await readFile('wrangler.jsonc', 'utf8'))
  const origins = {
    site: parseOrigin(options.site ?? vars.PUBLIC_ORIGIN),
    content: parseOrigin(options['content-origin'] ?? vars.CONTENT_ORIGIN),
    admin: parseOrigin(options['admin-origin'] ?? vars.OPERATOR_ORIGIN),
  }
  if (!origins.site || !origins.content || !origins.admin) {
    console.error('refused: an origin is missing or is not an origin')
    return 2
  }
  const results = await runPostDeployChecks(
    origins,
    limitTime(fetch, CHECK_TIMEOUT_MS),
  )
  for (const line of checkLines(results)) console.log(line)
  const failed = failedChecks(results)
  if (failed.length > 0) console.log(`failed: ${failed.join(', ')}`)
  return failed.length > 0 ? 1 : 0
}

process.exitCode = await main()
