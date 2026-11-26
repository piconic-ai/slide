import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Column, is } from 'drizzle-orm'
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import { app } from '../src/app/routes'
import * as authSchema from '../src/db/auth-schema'
import * as schema from '../src/db/schema'
import { operatorApp, operatorConfigOf } from '../src/operator/routes'
import {
  ADDRESS_ACCESSORS,
  ADDRESS_COLUMN_NAME,
  ADDRESS_COLUMNS,
  ADDRESS_EXPOSURES,
  ADDRESS_READERS,
  IGNORED_RECEIVERS,
} from '../src/privacy/email-exposure'
import {
  OPERATOR_PAGES,
  OTHER_PATHS,
  PAGES,
  SCOPE4_PATHS,
} from '../src/site/test-no-email-pages'
import {
  columnProblems,
  DECLARATION_FILE,
  reasonProblems,
  routeProblems,
  staleProblems,
  undeclaredProblems,
} from './email-exposure-check.mjs'
import { touchesOf } from './email-touches.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// The declaration of where an email address is kept, read and shown
// (src/privacy/email-exposure.ts) judged against the real schema, source and
// routes. The judging is in email-exposure-check.mjs, which its own tests
// feed made-up data; here it is fed the repository.

/** Every column of every table, with how the schema exports it. */
const schemaColumns = [schema, authSchema].flatMap((module) =>
  Object.entries(module)
    .filter(([, value]) => is(value, SQLiteTable))
    .flatMap(([exported, table]) =>
      Object.entries(table)
        .filter(([, value]) => is(value, Column))
        .map(([key, column]) => ({
          table: getTableConfig(table).name,
          column: column.name,
          drizzle: `${exported}.${key}`,
        })),
    ),
)

const sources = readdirSync(join(ROOT, 'src'), { recursive: true })
  .map((file) => `src/${String(file).replaceAll('\\', '/')}`)
  .filter((path) => /\.tsx?$/.test(path))
  .filter((path) => !/\.test\.|\.d\.ts$|\/test-[^/]*$/.test(path))
  // The declaration names the tables and columns it is about.
  .filter((path) => path !== DECLARATION_FILE)

const touches = new Map(
  sources.map((path) => [
    path,
    touchesOf(path, readFileSync(join(ROOT, path), 'utf8'), {
      columns: ADDRESS_COLUMNS.filter((column) => column.kind === 'subscriber'),
      ignoredReceivers: IGNORED_RECEIVERS.map(({ name }) => name),
      accessors: ADDRESS_ACCESSORS,
    }),
  ]),
)

/** What an app answers to a GET: its routes, without the catch-alls. */
const getRoutes = (host, application) =>
  application.routes
    .filter(({ method, path }) => method === 'GET' && !path.endsWith('/*'))
    .map(({ path }) => ({ host, route: path }))

describe('the declaration of where an email address is kept', () => {
  it('F43-AC1: Given every column of the schema, When the ones named like an address are listed, Then each is declared in a kind, and every declared column exists', () => {
    expect(schemaColumns.length).toBeGreaterThan(100)
    expect(
      columnProblems({
        schemaColumns,
        declared: ADDRESS_COLUMNS,
        named: ADDRESS_COLUMN_NAME,
      }),
    ).toEqual([])
  })

  it('F43-AC2: Given the source, When each file is read for the columns and the `email` it touches, Then only the files the declaration lets read an address do', () => {
    expect(sources.length).toBeGreaterThan(500)
    expect(undeclaredProblems({ touches, readers: ADDRESS_READERS })).toEqual(
      [],
    )
  })

  it('F43-AC3: Given the declaration, When its reasons are read, Then every column, file, place and receiver has one sentence, and every place has a scene in both languages', () => {
    expect(
      reasonProblems({
        columns: ADDRESS_COLUMNS,
        readers: ADDRESS_READERS,
        exposures: ADDRESS_EXPOSURES,
        ignoredReceivers: IGNORED_RECEIVERS,
      }),
    ).toEqual([])
  })

  it('F43-AC5: Given the files the declaration lets read an address, When the source is read, Then each exists and still touches what is declared for it', () => {
    expect(staleProblems({ touches, readers: ADDRESS_READERS })).toEqual([])
    for (const reader of ADDRESS_READERS)
      expect(touches.get(reader.file), reader.file).toEqual(
        reader.touches.toSorted(),
      )
  })

  it('F43-AC9: Given the GET routes of the app and of the operator host, When the pages the leak test opens are matched against them, Then each is opened there or is a place the declaration lists', () => {
    const operator = operatorApp(
      operatorConfigOf({
        OPERATOR_ORIGIN: 'https://admin.slide.example',
        ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
        ACCESS_AUD: 'a'.repeat(64),
        PUBLIC_ORIGIN: 'https://slide.example',
        CONTENT_ORIGIN: 'https://content.slide.example',
      }),
    )
    const routes = [
      ...getRoutes('site', app),
      ...getRoutes('operator', operator),
    ]
    expect(routes.length).toBeGreaterThan(40)
    expect(
      routeProblems({
        routes,
        samples: {
          site: [...PAGES, ...SCOPE4_PATHS, ...OTHER_PATHS],
          operator: OPERATOR_PAGES,
        },
        exposures: ADDRESS_EXPOSURES,
      }),
    ).toEqual([])
  })
})
