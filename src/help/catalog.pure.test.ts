import { describe, expect, test } from 'vitest'
import { html } from 'hono/html'
import { HELP_AIMS, isHelpAim } from './aims'
import { defineArticle, type Article } from './article'
import {
  articlesOfAim,
  buildCatalog,
  catalogProblems,
  findArticle,
  isHelpPath,
  MAX_RELATED,
  relatedOf,
  type RegisteredArticle,
} from './catalog'
import { HELP_CATALOG } from './default-catalog'
import { HELP_BOT_PATH } from './paths'
import { HELP_REGISTRY } from './registry.generated'

const fixture = (order = 10, related: readonly string[] = []): Article =>
  defineArticle({
    order,
    form: 'reference',
    related,
    ja: { title: 't', lead: () => html`l`, body: () => html`b` },
    en: { title: 't', lead: () => html`l`, body: () => html`b` },
  })

describe('the aims', () => {
  test('F36-AC2: Given the aims, When they are listed, Then they are the eight, in the order the help names them', () => {
    expect(HELP_AIMS).toEqual([
      'start',
      'slides',
      'articles',
      'sharing',
      'community',
      'agent',
      'account',
      'safety',
    ])
  })

  test('F36-AC25: Given the bot’s path, When it is read as an aim, Then it is none, so no aim can hide it', () => {
    expect(HELP_BOT_PATH).toBe('/help/bot')
    expect(isHelpAim('bot')).toBe(false)
    for (const word of ['', 'Start', 'start/', 'missing', '__proto__'])
      expect(isHelpAim(word)).toBe(false)
  })
})

describe('the help’s own articles', () => {
  test('F36-AC12: Given the registry the script wrote, When it is checked, Then it has no problem', () => {
    expect(catalogProblems(HELP_REGISTRY)).toEqual([])
  })

  test('F36-AC3: Given the catalog, When each aim is read, Then it has articles', () => {
    for (const aim of HELP_AIMS)
      expect(articlesOfAim(HELP_CATALOG, aim).length).toBeGreaterThan(0)
  })

  test('F36-AC12: Given the catalog, When its articles are read in order, Then the aims, then each article’s order, then its slug decide', () => {
    const keys = HELP_CATALOG.map((entry) => entry.key)
    expect(keys).toHaveLength(HELP_REGISTRY.length)
    const aimRank = (aim: string) => HELP_AIMS.indexOf(aim as never)
    for (let i = 1; i < HELP_CATALOG.length; i += 1) {
      const a = HELP_CATALOG[i - 1]!
      const b = HELP_CATALOG[i]!
      expect(aimRank(a.aim)).toBeLessThanOrEqual(aimRank(b.aim))
      if (a.aim === b.aim) {
        expect(a.article.order).toBeLessThanOrEqual(b.article.order)
        if (a.article.order === b.article.order)
          expect(a.slug < b.slug).toBe(true)
      }
    }
  })

  test('F36-AC6: Given an article, When its path is read, Then it is the aim and the slug under /help', () => {
    const entry = findArticle(HELP_CATALOG, 'start', 'sign-in')
    expect(entry?.path).toBe('/help/start/sign-in')
    expect(entry?.key).toBe('start/sign-in')
  })

  test.each([
    ['missing', 'sign-in'],
    ['start', 'missing'],
    ['bot', 'sign-in'],
    ['', ''],
    ['start', 'sign-in/'],
    ['START', 'sign-in'],
  ])(
    'F36-AC25: Given the path with aim %j and slug %j, When it is looked up, Then there is no article',
    (aim, slug) => {
      expect(findArticle(HELP_CATALOG, aim, slug)).toBeNull()
    },
  )

  test('F36-AC7: Given every article, When its related articles are read, Then there are at most three and each exists', () => {
    for (const entry of HELP_CATALOG) {
      expect(entry.article.related.length).toBeLessThanOrEqual(MAX_RELATED)
      expect(relatedOf(HELP_CATALOG, entry)).toHaveLength(
        entry.article.related.length,
      )
    }
  })
})

describe('adding an article file', () => {
  test('F36-AC12: Given a new article under an aim, When the catalog is built, Then it is in that aim’s list with its URL, and nothing else changed', () => {
    const before = articlesOfAim(HELP_CATALOG, 'slides')
    const added: RegisteredArticle[] = [
      ...HELP_REGISTRY,
      ['slides/brand-new', fixture(1)],
    ]
    expect(catalogProblems(added)).toEqual([])
    const catalog = buildCatalog(added)
    const after = articlesOfAim(catalog, 'slides')
    expect(after).toHaveLength(before.length + 1)
    expect(after[0]?.path).toBe('/help/slides/brand-new')
    expect(articlesOfAim(catalog, 'start')).toEqual(
      articlesOfAim(HELP_CATALOG, 'start'),
    )
  })
})

describe('what makes a registry unsound', () => {
  const ok = fixture()
  test.each([
    ['an unknown aim', [['nope/a', ok]], 'nope/a: not a known aim and a slug'],
    ['the bot as an aim', [['bot/a', ok]], 'bot/a: not a known aim and a slug'],
    ['no slug', [['slides', ok]], 'slides: not a known aim and a slug'],
    [
      'a deeper path',
      [['slides/a/b', ok]],
      'slides/a/b: not a known aim and a slug',
    ],
    [
      'a slug in capitals',
      [['slides/Abc', ok]],
      'slides/Abc: not a known aim and a slug',
    ],
    [
      'a slug with a dot',
      [['slides/a.b', ok]],
      'slides/a.b: not a known aim and a slug',
    ],
    [
      'a slug with a space',
      [['slides/a b', ok]],
      'slides/a b: not a known aim and a slug',
    ],
    ['an empty slug', [['slides/', ok]], 'slides/: not a known aim and a slug'],
    [
      'a doubled hyphen',
      [['slides/a--b', ok]],
      'slides/a--b: not a known aim and a slug',
    ],
    [
      'a slug a layer check reads',
      [['slides/routes', ok]],
      'slides/routes: not a known aim and a slug',
    ],
    [
      'a slug the page layer reads',
      [['slides/page', ok]],
      'slides/page: not a known aim and a slug',
    ],
    [
      'one path twice',
      [
        ['slides/a', ok],
        ['slides/a', ok],
      ],
      'slides/a: listed twice',
    ],
    [
      'an unknown related article',
      [['slides/a', fixture(1, ['slides/zzz'])]],
      'slides/a: unknown slides/zzz',
    ],
    [
      'a related article of its own',
      [['slides/a', fixture(1, ['slides/a'])]],
      'slides/a: relates to itself',
    ],
    [
      'four related articles',
      [
        [
          'slides/a',
          fixture(1, ['slides/b', 'slides/c', 'slides/d', 'slides/e']),
        ],
        ['slides/b', ok],
        ['slides/c', ok],
        ['slides/d', ok],
        ['slides/e', ok],
      ],
      'slides/a: more than 3 related articles',
    ],
    [
      'the same related article twice',
      [
        ['slides/a', fixture(1, ['slides/b', 'slides/b'])],
        ['slides/b', ok],
      ],
      'slides/a: a related article twice',
    ],
  ] as const)(
    'F36-AC12: Given %s, When the registry is checked, Then it says so',
    (_, registered, problem) => {
      expect(
        catalogProblems(registered as readonly RegisteredArticle[]),
      ).toContain(problem)
    },
  )

  test('F36-AC25: Given a malformed path, When the catalog is built, Then it is left out and the others stay', () => {
    expect(
      buildCatalog([
        ['nope/a', ok],
        ['slides/fine', ok],
      ]).map((entry) => entry.key),
    ).toEqual(['slides/fine'])
  })
})

describe('the paths the help answers', () => {
  test('F36-AC48: Given the help’s paths, When they are checked, Then the entrance, the aims, the articles and the bot are the help’s and nothing else is', () => {
    expect(isHelpPath(HELP_CATALOG, '/help')).toBe(true)
    expect(isHelpPath(HELP_CATALOG, '/help/bot')).toBe(true)
    expect(isHelpPath(HELP_CATALOG, '/help/start')).toBe(true)
    expect(isHelpPath(HELP_CATALOG, '/help/start/sign-in')).toBe(true)
    for (const path of [
      '/help/',
      '/help/nope',
      '/help/start/nope',
      '/help#start',
    ])
      expect(isHelpPath(HELP_CATALOG, path)).toBe(false)
  })
})
