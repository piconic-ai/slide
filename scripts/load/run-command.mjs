// The command of scripts/load/run.mjs. It takes everything it touches in `io`
// (the network, the clock, files, output), so a test runs it against a fake
// server and a fake clock, and so no part of it sends a request on its own.
//
//   node scripts/load/run.mjs hot-slide --origin http://localhost:8787 --slide /@alice/talk
//   node scripts/load/run.mjs venue-300 --origin http://localhost:8787 --slide /@alice/talk
//   node scripts/load/run.mjs post-talk-uploads --origin http://localhost:8787 --cookies cookies.json
//
// The first thing it does is judge --origin; an address of production is
// refused with exit code 2 before any request is made (D-142).
import { makeClient, RequestBudgetSpent } from './client.mjs'
import { checkOrigin, RefusedAddress } from './origin-guard.mjs'
import { evenStarts, mulberry32, randomStarts, viewsIn } from './plan.mjs'
import { runSchedule } from './runner.mjs'
import { openSlide, putSlideUp, slideFiles } from './scenarios.mjs'
import { renderSummary, summarize } from './stats.mjs'

export const SCENARIOS = ['hot-slide', 'venue-300', 'post-talk-uploads']

/** The numbers each option takes, with the name it sets and the least it may be. */
const NUMBERS = {
  '--duration': ['duration', 1],
  '--views-per-minute': ['viewsPerMinute', 1],
  '--viewers': ['viewers', 1],
  '--within': ['within', 1],
  '--uploads': ['uploads', 1],
  '--files': ['files', 1],
  '--file-bytes': ['fileBytes', 16],
  '--max-requests': ['maxRequests', 1],
  '--max-in-flight': ['maxInFlight', 1],
  '--timeout': ['timeoutSeconds', 1],
  '--seed': ['seed', 0],
}
const WORDS = {
  '--origin': 'origin',
  '--slide': 'slide',
  '--cookies': 'cookies',
  '--client-ip': 'clientIp',
}

/** Settings that apply to every scenario unless an option changes them. */
const DEFAULTS = {
  duration: 60,
  viewsPerMinute: 1000,
  viewers: 300,
  within: 60,
  uploads: 50,
  files: 30,
  fileBytes: 2000,
  maxRequests: 200_000,
  maxInFlight: 500,
  timeoutSeconds: 30,
  seed: 1,
}

/** A usage error: the arguments are wrong, and nothing was sent. */
export class UsageError extends Error {}

const has = (table, key) => Object.hasOwn(table, key)

function numberOf(flag, value, least) {
  const number = Number(value)
  if (value.trim() === '' || !Number.isInteger(number) || number < least)
    throw new UsageError(`${flag} needs a whole number of ${least} or more`)
  return number
}

/** Sets the setting an option with a value names; an unknown option is refused. */
function setOption(settings, flag, value) {
  if (has(NUMBERS, flag)) {
    const [name, least] = NUMBERS[flag]
    settings[name] = numberOf(flag, value, least)
  } else if (has(WORDS, flag)) settings[WORDS[flag]] = value
  else throw new UsageError(`Unknown option ${flag}`)
}

/** Reads the arguments into settings; throws UsageError for a bad one. */
export function parseArgs(argv) {
  const [scenario, ...rest] = argv
  if (!SCENARIOS.includes(scenario))
    throw new UsageError(`The first argument is one of ${SCENARIOS.join(', ')}`)
  const settings = { scenario, json: false, ...DEFAULTS }
  for (let at = 0; at < rest.length; at++) {
    const flag = rest[at]
    if (flag === '--json') {
      settings.json = true
      continue
    }
    const value = rest[++at]
    if (value === undefined) throw new UsageError(`${flag} needs a value`)
    setOption(settings, flag, value)
  }
  requireSettings(settings)
  return settings
}

/** Throws UsageError when what the scenario needs is missing or malformed. */
function requireSettings(settings) {
  if (!settings.origin) throw new UsageError('--origin is required')
  if (settings.scenario === 'post-talk-uploads') {
    if (!settings.cookies)
      throw new UsageError(
        '--cookies is required: a JSON file of author session cookies',
      )
    return
  }
  if (!settings.slide)
    throw new UsageError(
      '--slide is required: the share path, such as /@alice/talk',
    )
  if (!/^\/@[a-z0-9-]+\/[A-Za-z0-9._-]+$/.test(settings.slide))
    throw new UsageError('--slide is a share path such as /@alice/talk')
}

/** The author cookies in a JSON text: a non-empty list of non-empty strings. */
export function parseCookies(text) {
  let list
  try {
    list = JSON.parse(text)
  } catch {
    throw new UsageError('--cookies must be a JSON list of cookie strings')
  }
  if (
    !Array.isArray(list) ||
    list.length === 0 ||
    list.some((c) => typeof c !== 'string' || c === '')
  )
    throw new UsageError('--cookies must be a JSON list of cookie strings')
  return list
}

/** The schedule and the task of a scenario. */
function planOf(settings, client, base, cookies) {
  const random = mulberry32(settings.seed)
  if (settings.scenario === 'hot-slide')
    return {
      starts: evenStarts(
        viewsIn(settings.viewsPerMinute, settings.duration),
        settings.duration,
      ),
      task: () => openSlide({ client, base, slidePath: settings.slide }),
    }
  if (settings.scenario === 'venue-300')
    return {
      starts: randomStarts(settings.viewers, settings.within, random),
      task: () => openSlide({ client, base, slidePath: settings.slide }),
    }
  return {
    starts: randomStarts(settings.uploads, settings.within, random),
    task: (index) =>
      putSlideUp({
        client,
        base,
        cookie: cookies[index % cookies.length],
        attempt: `load-${settings.seed}-${String(index).padStart(10, '0')}`,
        files: slideFiles({
          count: settings.files,
          bytes: settings.fileBytes,
          seed: `${settings.seed}-${index}`,
        }),
      }),
  }
}

/**
 * Runs the command and returns the exit code: 0 for a run (whatever the
 * statuses), 1 for a usage error, 2 for an address that is refused.
 *
 * @param {string[]} argv
 * @param {{
 *   send: (address: string, init: RequestInit) => Promise<Response>,
 *   now: () => number,
 *   sleep: (ms: number) => Promise<void>,
 *   timeoutSignal: (ms: number) => AbortSignal,
 *   readFile: (path: string) => Promise<string>,
 *   print: (text: string) => void,
 *   printError: (text: string) => void,
 * }} io
 */
export async function main(argv, io) {
  let settings
  try {
    settings = parseArgs(argv)
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    io.printError(error.message)
    return 1
  }
  const checked = checkOrigin(settings.origin)
  if (!checked.ok) {
    io.printError(`Refused: ${checked.reason}. Nothing was sent.`)
    return 2
  }
  let cookies = []
  try {
    if (settings.scenario === 'post-talk-uploads')
      cookies = parseCookies(await io.readFile(settings.cookies))
  } catch (error) {
    io.printError(error.message)
    return 1
  }
  const records = []
  const client = makeClient({
    send: io.send,
    now: io.now,
    timeoutSignal: io.timeoutSignal,
    records,
    maxRequests: settings.maxRequests,
    timeoutMs: settings.timeoutSeconds * 1000,
    clientIp: settings.clientIp ?? null,
  })
  const plan = planOf(settings, client, checked.url.origin, cookies)
  let outcome
  try {
    outcome = await runSchedule({
      starts: plan.starts,
      task: plan.task,
      maxInFlight: settings.maxInFlight,
      now: io.now,
      sleep: io.sleep,
    })
  } catch (error) {
    if (error instanceof RefusedAddress) {
      io.printError(`Refused: ${error.message}. The run stopped.`)
      return 2
    }
    if (!(error instanceof RequestBudgetSpent)) throw error
    io.printError(`${error.message}; the report covers what was sent.`)
    outcome = { seconds: 0, started: 0, late: 0 }
  }
  const summary = summarize(records)
  const run = {
    scenario: settings.scenario,
    target: checked.url.origin,
    seconds: outcome.seconds,
  }
  io.print(
    settings.json
      ? JSON.stringify(
          { ...run, started: outcome.started, late: outcome.late, ...summary },
          null,
          2,
        )
      : `${renderSummary(summary, run)}\nStarted late (waiting for a place): ${outcome.late}`,
  )
  return 0
}
