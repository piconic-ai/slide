// The command of scripts/cost/estimate.mjs: prints the monthly cost estimate of docs/dev/scale-cost.md (D-140).
//
//   node scripts/cost/estimate.mjs --views 100000
//   node scripts/cost/estimate.mjs --table
//   node scripts/cost/estimate.mjs --print-prices   (the tables of the design)
//   node scripts/cost/estimate.mjs --print-per-use
//   node scripts/cost/estimate.mjs --views 1000000 --per-use measured.json
//   node scripts/cost/estimate.mjs --views 1000000 --size large --list profile
//
// Every input has a default (see defaults.mjs); a flag `--name value` changes
// one. `--per-use FILE` reads a JSON object that replaces fields of the
// per-use counts, as measured in production (docs/dev/scale-cost.md).
import { inputsFor, TABLE_VIEWS } from './defaults.mjs'
import { PER_USE } from './per-use.mjs'
import { estimate } from './formula.mjs'
import { PRICES } from './prices.mjs'
import {
  renderEstimate,
  renderPerUse,
  renderPrices,
  renderTable,
} from './render.mjs'

/** The flags that take a number or a day, and the input each one sets. */
const FLAGS = {
  '--views': 'views',
  '--slides': 'slides',
  '--uploads': 'uploads',
  '--list-views': 'listViews',
  '--emails': 'emails',
  '--covers-per-view': 'coversPerView',
  '--revisit-share': 'revisitShare',
  '--cache-hit-rate': 'cacheHitRate',
  '--versions-per-slide': 'versionsPerSlide',
  '--bytes-per-version': 'bytesPerVersion',
  '--d1-bytes-per-slide': 'd1BytesPerSlide',
  '--log-events-per-request': 'logEventsPerRequest',
  '--log-bytes-per-event': 'logBytesPerEvent',
  '--analytics-points-per-view': 'analyticsPointsPerView',
  '--analytics-points-per-upload': 'analyticsPointsPerUpload',
  '--as-of': 'asOf',
}
const USES = ['view', 'revisit', 'upload', 'list', 'cover']
/** The flags that take no value, and the field each one sets. */
const SWITCHES = {
  '--table': ['table', true],
  '--json': ['json', true],
  '--backup': ['backup', true],
  '--no-backup': ['backup', false],
  '--print-prices': ['print', 'prices'],
  '--print-per-use': ['print', 'per-use'],
}
/** The flags that take one of a few words. */
const CHOICES = {
  '--size': ['size', ['small', 'normal', 'large']],
  '--list': ['list', Object.keys(PER_USE.list)],
}

const has = (table, key) => Object.hasOwn(table, key)

/** The number a flag was given, or an error that names the flag. */
function numberOf(flag, value) {
  const number = Number(value)
  if (value.trim() === '' || !Number.isFinite(number))
    throw new Error(`${flag} needs a number, not ${JSON.stringify(value)}`)
  return number
}

/** Sets the field a flag with a value names; an unknown flag is refused. */
function setValue(parsed, flag, value) {
  if (flag === '--per-use') parsed.perUse = value
  else if (has(CHOICES, flag)) {
    const [name, choices] = CHOICES[flag]
    if (!choices.includes(value))
      throw new Error(`${flag} is one of ${choices.join(', ')}`)
    parsed[name] = value
  } else if (flag === '--as-of') parsed.overrides.asOf = value
  else if (has(FLAGS, flag))
    parsed.overrides[FLAGS[flag]] = numberOf(flag, value)
  else throw new Error(`Unknown option ${flag}`)
}

/** @returns {{ overrides: Record<string, unknown>, table: boolean, json: boolean, perUse: string | null, backup: boolean | null, size: string | undefined, list: string | undefined, print: string | null }} */
export function parseArgs(argv) {
  const parsed = {
    overrides: {},
    table: false,
    json: false,
    perUse: null,
    backup: null,
    size: undefined,
    list: undefined,
    print: null,
  }
  for (let at = 0; at < argv.length; at++) {
    const flag = argv[at]
    if (has(SWITCHES, flag)) parsed[SWITCHES[flag][0]] = SWITCHES[flag][1]
    else {
      const value = argv[++at]
      if (value === undefined) throw new Error(`${flag} needs a value`)
      setValue(parsed, flag, value)
    }
  }
  return parsed
}

/** Replaces fields of the per-use counts with those of a measured object. */
export function mergePerUse(inputs, measured) {
  const merged = { ...inputs }
  for (const [use, fields] of Object.entries(measured ?? {})) {
    if (!USES.includes(use))
      throw new Error(`Unknown use ${use} in the per-use file`)
    merged[use] = { ...merged[use], ...fields }
  }
  return merged
}

/**
 * Runs the command. `io` gives it the day, a file reader and an output
 * function, so a test runs it without a clock, a disk or a terminal.
 */
export async function main(argv, io) {
  const args = parseArgs(argv)
  if (args.print) {
    io.print(
      args.print === 'prices' ? renderPrices(PRICES) : renderPerUse(PER_USE),
    )
    return
  }
  const measured = args.perUse ? JSON.parse(await io.readFile(args.perUse)) : {}
  const asOf = args.overrides.asOf ?? io.today()
  const make = (views) =>
    mergePerUse(
      {
        ...inputsFor(views, { size: args.size, list: args.list }),
        ...(args.backup === null ? {} : { backup: args.backup }),
        ...args.overrides,
        asOf,
      },
      measured,
    )
  if (args.table) {
    const rows = TABLE_VIEWS.map((views) => ({
      views,
      result: estimate(make(views)),
    }))
    io.print(args.json ? JSON.stringify(rows, null, 2) : renderTable(rows))
    return
  }
  const inputs = make(args.overrides.views ?? TABLE_VIEWS[1])
  const result = estimate(inputs)
  io.print(
    args.json
      ? JSON.stringify({ inputs, result }, null, 2)
      : renderEstimate(inputs, result),
  )
}
