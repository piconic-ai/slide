// What the release script is asked to do, and whether it may. Pure: the
// environment and the arguments are inputs. docs/dev/release-flow.md (REL-AC10).

/** The only branch Workers Builds deploys to production from (D-100, D-105). */
export const PRODUCTION_BRANCH = 'release'

/**
 * Options of the form `--name value`, and the one flag that takes no value.
 * Returns null for an argument it does not understand, so a typo stops the run.
 */
export function parseArgs(argv) {
  const options = {}
  const flags = new Set()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--allow-outside-ci') flags.add('allow-outside-ci')
    else if (arg.startsWith('--') && arg.length > 2 && i + 1 < argv.length)
      options[arg.slice(2)] = argv[++i]
    else return null
  }
  return { options, flags }
}

/** Whether the run is a Workers Builds build. */
export const inWorkersBuilds = (env) => env.WORKERS_CI === '1'

/**
 * Why this run must not go on, or null. Production is deployed only by
 * Workers Builds building the production branch: a run from a laptop is
 * refused unless the flag asks for it (and then the checkout must be the
 * pushed release; see release-source.mjs), and a Workers Builds build of
 * another branch is refused whatever the flag says.
 */
export function refusal(env, flags) {
  if (!inWorkersBuilds(env))
    return flags.has('allow-outside-ci')
      ? null
      : 'this deploys production and runs only in Workers Builds (pass --allow-outside-ci to override)'
  const branch = env.WORKERS_CI_BRANCH
  if (branch !== PRODUCTION_BRANCH)
    return `Workers Builds deploys production from the ${PRODUCTION_BRANCH} branch only, not ${JSON.stringify(branch ?? '')}`
  return null
}

/** `text` without any of the secrets in it, for a log everyone on the build reads. */
export const redacted = (text, secrets) =>
  secrets
    .filter(Boolean)
    .reduce((out, secret) => out.split(secret).join('[redacted]'), text)

/** The `vars` of the checked-in configuration, whose text holds comments. */
export function varsOfWranglerConfig(text) {
  const json = text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')
  return JSON.parse(json).vars ?? {}
}
