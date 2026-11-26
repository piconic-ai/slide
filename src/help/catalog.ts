import { HELP_AIMS, isHelpAim, type HelpAim } from './aims'
import type { Article } from './article'
import { HELP_BOT_PATH, helpArticlePath } from './paths'
import type { SignupMode } from '../auth/signup-mode'

/** What the generated registry lists: an article and where its file is. */
export type RegisteredArticle = readonly [path: string, article: Article]

/** An article that is known to be in an aim. */
export type CatalogEntry = Readonly<{
  aim: HelpAim
  slug: string
  /** `<aim>/<slug>`, the key `related` names. */
  key: string
  path: string
  article: Article
}>

export type Catalog = readonly CatalogEntry[]

/** A slug is lowercase words joined by hyphens. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/**
 * Names that a layer check reads as a layer when they end a file's name
 * (docs/dev/architecture.md), so an article cannot take them.
 */
const LAYER_WORDS = new Set([
  'routes',
  'api',
  'middleware',
  'store',
  'client',
  'page',
  'pages',
  'schema',
])

export const MAX_RELATED = 3

/** The aim and the slug of a registered path, or null for a malformed one. */
function split(path: string): { aim: HelpAim; slug: string } | null {
  const [aim, slug, ...rest] = path.split('/')
  if (!aim || !slug || rest.length > 0) return null
  if (!isHelpAim(aim) || !SLUG.test(slug) || LAYER_WORDS.has(slug)) return null
  return { aim, slug }
}

/** The problems of the registered paths themselves. */
function pathProblems(registered: readonly RegisteredArticle[]): string[] {
  const problems: string[] = []
  const keys = new Set<string>()
  for (const [path] of registered) {
    if (!split(path)) problems.push(`${path}: not a known aim and a slug`)
    if (keys.has(path)) problems.push(`${path}: listed twice`)
    keys.add(path)
  }
  return problems
}

/** The problems of what one article names as related. */
function relatedProblems(
  path: string,
  article: Article,
  keys: ReadonlySet<string>,
): string[] {
  const problems: string[] = []
  if (article.related.length > MAX_RELATED)
    problems.push(`${path}: more than ${MAX_RELATED} related articles`)
  for (const key of article.related) {
    if (key === path) problems.push(`${path}: relates to itself`)
    else if (!keys.has(key)) problems.push(`${path}: unknown ${key}`)
  }
  if (new Set(article.related).size !== article.related.length)
    problems.push(`${path}: a related article twice`)
  return problems
}

/**
 * What is wrong with a set of registered articles, in words; empty when it
 * is sound. A test holds the real registry to this, so a mistake in a new
 * article file fails there and the page never has to guess.
 */
export function catalogProblems(
  registered: readonly RegisteredArticle[],
): readonly string[] {
  const keys = new Set(registered.map(([path]) => path))
  return [
    ...pathProblems(registered),
    ...registered.flatMap(([path, article]) =>
      relatedProblems(path, article, keys),
    ),
  ]
}

/**
 * The articles in reading order: the aims' order, then each article's
 * `order`, then its slug. A malformed path is left out; `catalogProblems`
 * reports it.
 */
export function buildCatalog(
  registered: readonly RegisteredArticle[],
): Catalog {
  const entries: CatalogEntry[] = []
  for (const [key, article] of registered) {
    const parts = split(key)
    if (parts)
      entries.push({
        ...parts,
        key,
        path: helpArticlePath(parts.aim, parts.slug),
        article,
      })
  }
  const rank = (entry: CatalogEntry) => HELP_AIMS.indexOf(entry.aim)
  return entries.toSorted(
    (a, b) =>
      rank(a) - rank(b) ||
      a.article.order - b.article.order ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  )
}

/**
 * The catalog as a reader of this mode sees it: without the articles that
 * are about an invitation while sign-up is open (F42-AC5). Invite-only sees
 * all of it.
 */
export const catalogFor = (catalog: Catalog, mode: SignupMode): Catalog =>
  mode === 'open'
    ? catalog.filter((entry) => entry.article.onlyWhile !== 'invitation')
    : catalog

export const articlesOfAim = (catalog: Catalog, aim: HelpAim) =>
  catalog.filter((entry) => entry.aim === aim)

export const findArticle = (catalog: Catalog, aim: string, slug: string) =>
  catalog.find((entry) => entry.aim === aim && entry.slug === slug) ?? null

/** The articles an article names as related, in the order it names them. */
export const relatedOf = (catalog: Catalog, entry: CatalogEntry) =>
  entry.article.related.flatMap((key) => {
    const found = catalog.find((other) => other.key === key)
    return found ? [found] : []
  })

/** Whether a path inside the help is one the help answers. */
export const isHelpPath = (catalog: Catalog, path: string) =>
  path === HELP_BOT_PATH ||
  catalog.some((entry) => entry.path === path) ||
  HELP_AIMS.some((aim) => path === `/help/${aim}`) ||
  path === '/help'
