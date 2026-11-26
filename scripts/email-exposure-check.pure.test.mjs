import { describe, expect, it } from 'vitest'
import {
  columnProblems,
  DECLARATION_FILE,
  isOneSentence,
  reasonProblems,
  readerProblems,
  routeProblems,
} from './email-exposure-check.mjs'
import { routePattern, uncovered } from './email-exposure-routes.mjs'

const NAMED = /email|mail|address|_by$/
const schemaColumns = [
  { table: 'auth_user', column: 'email', drizzle: 'authUser.email' },
  { table: 'auth_user', column: 'name', drizzle: 'authUser.name' },
  { table: 'decks', column: 'hidden_by', drizzle: 'decks.hidden_by' },
]
const declared = [
  {
    table: 'auth_user',
    column: 'email',
    kind: 'subscriber',
    drizzle: 'authUser.email',
    reason: 'Where it signs in.',
  },
  {
    table: 'decks',
    column: 'hidden_by',
    kind: 'operator',
    reason: 'The operator.',
  },
]
const columns = (extra = {}) =>
  columnProblems({
    schemaColumns: extra.schemaColumns ?? schemaColumns,
    declared: extra.declared ?? declared,
    named: NAMED,
  })

describe('F43-AC1: columnProblems', () => {
  it('Given every named column declared, Then there is no problem', () => {
    expect(columns()).toEqual([])
  })

  it('Given a column named like an address that the declaration lacks, Then it is named with what to check first (F43-AC4)', () => {
    const [problem, ...rest] = columns({
      schemaColumns: [
        ...schemaColumns,
        {
          table: 'profiles',
          column: 'contact_email',
          drizzle: 'profiles.contact_email',
        },
      ],
    })
    expect(rest).toEqual([])
    expect(problem).toContain('profiles.contact_email')
    expect(problem).toContain(DECLARATION_FILE)
    expect(problem).toContain('not shown anywhere outside the places')
    expect(problem).toContain('user id or a keyed hash')
  })

  it.each([
    ['mail', 'mailed_at'],
    ['address', 'ip_address'],
    ['email', 'email_verified'],
    ['_by', 'named_by'],
  ])(
    'Given a column whose name has %s, Then it must be declared',
    (_part, name) => {
      expect(
        columns({
          schemaColumns: [
            ...schemaColumns,
            { table: 't', column: name, drizzle: `t.${name}` },
          ],
        }),
      ).toHaveLength(1)
    },
  )

  it('Given a column that is not named like an address and is not declared, Then it is left alone', () => {
    expect(columns()).toEqual([])
  })

  it('Given a declared column the schema does not have, Then the declaration is said to be wider than the schema', () => {
    const [problem] = columns({
      declared: [
        ...declared,
        {
          table: 'gone',
          column: 'email',
          kind: 'subscriber',
          drizzle: 'gone.email',
          reason: 'x.',
        },
      ],
    })
    expect(problem).toContain('gone.email')
    expect(problem).toContain('no such column')
  })

  it("Given a subscriber column whose drizzle name is not the schema's, Then it is a problem", () => {
    expect(
      columns({
        declared: [{ ...declared[0], drizzle: 'user.email' }, declared[1]],
      })[0],
    ).toContain('authUser.email')
  })

  it('Given a column declared twice or in a kind that does not exist, Then each is a problem', () => {
    const problems = columns({
      declared: [...declared, declared[1], { ...declared[1], kind: 'maybe' }],
    })
    expect(problems.some((p) => p.includes('twice'))).toBe(true)
    expect(problems.some((p) => p.includes('"maybe"'))).toBe(true)
  })
})

describe('F43-AC3: reasons', () => {
  it.each([
    ['one sentence', 'It is the address.', true],
    [
      'a sentence with a parenthesis that has a stop',
      'It is the address (see F35. Yes).',
      true,
    ],
    ['a sentence with code', 'It reads `a. b` only.', true],
    ['an empty reason', '', false],
    ['spaces only', '   ', false],
    ['no full stop', 'It is the address', false],
    ['two sentences', 'It is the address. It is kept.', false],
    ['two lines', 'It is\nthe address.', false],
    ['not a string', undefined, false],
  ])('Given %s, Then isOneSentence is %s', (_label, reason, ok) => {
    expect(isOneSentence(reason)).toBe(ok)
  })

  const base = {
    columns: [],
    readers: [{ file: 'src/a.ts', reason: 'Why.' }],
    exposures: [{ id: 'a', reason: 'Why.', scene: { ja: 'あ', en: 'a' } }],
    ignoredReceivers: [{ name: 'z', reason: 'Why.' }],
  }

  it('Given every row with a reason and every place with both scenes, Then there is no problem', () => {
    expect(reasonProblems(base)).toEqual([])
  })

  it('Given a file row without a reason, Then the problem names the file', () => {
    const [problem] = reasonProblems({
      ...base,
      readers: [{ file: 'src/a.ts', reason: '' }],
    })
    expect(problem).toContain('src/a.ts')
    expect(problem).toContain('no reason')
  })

  it('Given a place with a scene missing in one language, Then the problem names the language', () => {
    const [problem] = reasonProblems({
      ...base,
      exposures: [{ ...base.exposures[0], scene: { ja: 'あ', en: ' ' } }],
    })
    expect(problem).toContain('no en scene')
  })

  it('Given a column and a receiver without a reason, Then both are named', () => {
    const problems = reasonProblems({
      ...base,
      columns: [{ table: 't', column: 'c', reason: undefined }],
      ignoredReceivers: [{ name: 'z', reason: 'a. b.' }],
    })
    expect(problems).toHaveLength(2)
  })
})

describe('F43-AC2, F43-AC4, F43-AC5: readerProblems', () => {
  const readers = [
    { file: 'src/a.ts', touches: ['auth_user.email'], reason: 'Why.' },
  ]
  const touches = (entries) => new Map(Object.entries(entries))

  it('Given the declared file touching what is declared, and a file that touches nothing, Then there is no problem', () => {
    expect(
      readerProblems({
        readers,
        touches: touches({ 'src/a.ts': ['auth_user.email'], 'src/b.ts': [] }),
      }),
    ).toEqual([])
  })

  it('Given a file that is not declared and reads an address, Then the problem names the file, the column, the declaration and what to check (F43-AC4)', () => {
    const [problem, ...rest] = readerProblems({
      readers,
      touches: touches({
        'src/a.ts': ['auth_user.email'],
        'src/new-store.ts': ['.email', 'auth_user.email'],
      }),
    })
    expect(rest).toEqual([])
    expect(problem).toContain('src/new-store.ts')
    expect(problem).toContain('.email, auth_user.email')
    expect(problem).toContain(DECLARATION_FILE)
    expect(problem).toContain('user id or a keyed hash')
  })

  it('Given a declared file that now touches one more, Then it is asked to be declared', () => {
    const [problem] = readerProblems({
      readers,
      touches: touches({ 'src/a.ts': ['.email', 'auth_user.email'] }),
    })
    expect(problem).toContain('now also touches .email')
  })

  it('Given a declared file that no longer touches an address, Then the declaration is said to claim more than the source (F43-AC5)', () => {
    const [problem] = readerProblems({
      readers,
      touches: touches({ 'src/a.ts': [] }),
    })
    expect(problem).toContain('no longer touches auth_user.email')
  })

  it('Given a declared file that is gone, Then it is a problem', () => {
    const [problem] = readerProblems({ readers, touches: touches({}) })
    expect(problem).toContain('src/a.ts')
    expect(problem).toContain('not there')
  })

  it('Given a file declared twice, Then it is a problem', () => {
    const problems = readerProblems({
      readers: [...readers, ...readers],
      touches: touches({ 'src/a.ts': ['auth_user.email'] }),
    })
    expect(problems.some((p) => p.includes('twice'))).toBe(true)
  })
})

describe('F43-AC9: routes', () => {
  it.each([
    ['/a', '/a', true],
    ['/a', '/a/b', false],
    ['/a/:id', '/a/1', true],
    ['/a/:id', '/a/', false],
    ['/a/:id', '/a/1/2', false],
    ['/a/*', '/a/b/c', true],
    ['/a/:id{(?:logo|cover)}', '/a/logo', true],
    ['/a/:id{(?:logo|cover)}', '/a/other', false],
    ['/robots.txt', '/robotsxtxt', false],
    ['/.well-known/x', '/.well-known/x', true],
  ])(
    'Given the route %s and the path %s, Then the match is %s',
    (route, path, matches) => {
      expect(routePattern(route).test(path)).toBe(matches)
    },
  )

  it('Given routes and sample paths with queries, Then the routes no sample reaches are listed', () => {
    expect(uncovered(['/b', '/a/:id', '/'], ['/a/1?x=1', '/'])).toEqual(['/b'])
  })

  const exposures = [
    {
      id: 'settings',
      where: { kind: 'page', host: 'site', method: 'GET', route: '/settings' },
    },
    {
      id: 'login',
      where: { kind: 'page', host: 'site', method: 'POST', route: '/login' },
    },
    { id: 'mail', where: { kind: 'mail' } },
  ]
  const routes = [
    { host: 'site', route: '/settings' },
    { host: 'site', route: '/login' },
    { host: 'site', route: '/help/:aim' },
    { host: 'operator', route: '/' },
  ]
  const samples = { site: ['/help/start', '/login'], operator: ['/'] }
  const judged = (override = {}) =>
    routeProblems({ routes, samples, exposures, ...override })

  it('Given every GET route opened or declared, Then there is no problem', () => {
    expect(judged()).toEqual([])
  })

  it('Given a GET route that is neither opened nor declared, Then it is named, with where to add it', () => {
    const [problem, ...rest] = judged({
      routes: [...routes, { host: 'site', route: '/new-page' }],
    })
    expect(rest).toEqual([])
    expect(problem).toContain('GET /new-page')
    expect(problem).toContain('src/site/test-no-email-pages.ts')
    expect(problem).toContain(DECLARATION_FILE)
  })

  it('Given a route of the operator host that is not opened, Then the host is named', () => {
    expect(
      judged({
        routes: [...routes, { host: 'operator', route: '/invites' }],
      })[0],
    ).toContain('operator host')
  })

  it('Given a place declared for a route the app does not answer, Then it is a problem', () => {
    expect(
      judged({ routes: routes.filter((r) => r.route !== '/settings') })[0],
    ).toContain('no such route')
  })

  it('Given a page that shows an address among the pages opened as clean, Then it is a problem', () => {
    expect(
      judged({
        samples: { ...samples, site: [...samples.site, '/settings?x=1'] },
      })[0],
    ).toContain('/settings?x=1')
  })
})
