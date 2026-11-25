/**
 * The rules an address of a related link is compared by, as data: which query
 * names are left out, and how an address of each site is written when it is
 * compared. One place for them, next to the kinds (`kind-hosts.ts`), so a site
 * is added by adding an entry. The decisions behind every entry are in the
 * spec of related links (F27, the table of normalization rules).
 *
 * The migrations that build the compared form of the links already kept
 * repeat these rules in SQL. A change here needs a migration that builds the
 * form again.
 */

/**
 * Query names left out wherever they appear: they only tell a site where a
 * reader came from. They are left out of the link's href too (F27-AC60), not
 * only out of the compared form.
 */
export const TRACKING_QUERY = {
  prefixes: ['utm_'],
  names: [
    'fbclid',
    'gclid',
    'mc_cid',
    'mc_eid',
    'msclkid',
    'yclid',
    'dclid',
    'igshid',
    'ref_src',
    '_ga',
    '_gl',
  ],
} as const satisfies Readonly<{
  prefixes: readonly string[]
  names: readonly string[]
}>

/**
 * An address taken apart as it is compared: the host without `www.` and a
 * final dot, the path without trailing slashes, and the query as its raw
 * `name=value` parts in the order written.
 */
export type ComparedPage = Readonly<{
  host: string
  /** The port when it is not the default one, else ''. */
  port: string
  path: string
  query: readonly string[]
}>

export type SiteRule = Readonly<{
  /** Host names the rule covers, without `www.`. */
  hosts: readonly string[]
  /** Whether every subdomain of those hosts is covered too. */
  subdomains: boolean
  /** Query names left out of the href too (F27-AC60, F27-AC61). */
  hrefDroppedQuery: readonly string[]
  /** Query names left out of the compared form only. */
  comparedWithout: readonly string[]
  /** The page an address of the site is compared as. */
  page: (page: ComparedPage) => ComparedPage
}>

const same = (page: ComparedPage) => page

/**
 * The sites with rules of their own. Zenn, Qiita, note, dev.to, Substack and
 * Hatena follow the common rules only, so they have no entry.
 */
export const SITE_RULES: readonly SiteRule[] = [
  {
    // connpass: an event is its id, whatever group's subdomain it is under.
    // The pages under an event stay apart (F27-AC69, F27-AC70).
    hosts: ['connpass.com'],
    subdomains: true,
    hrefDroppedQuery: [],
    comparedWithout: [],
    page: (page) =>
      /^\/event\/\d+(?:\/|$)/u.test(page.path)
        ? { ...page, host: 'connpass.com' }
        : page,
  },
  {
    // Luma: one site under three hosts, and a slug read without case
    // (F27-AC71, F27-AC72). `tk` is an invitation token (F27-AC60).
    hosts: ['lu.ma', 'luma.com'],
    subdomains: false,
    hrefDroppedQuery: ['tk'],
    comparedWithout: [],
    page: (page) => ({
      ...page,
      host: 'luma.com',
      path: page.path.toLowerCase(),
    }),
  },
  {
    // Medium: `source` tells the post where a reader came from (F27-AC61,
    // F27-AC82).
    hosts: ['medium.com'],
    subdomains: true,
    hrefDroppedQuery: ['source'],
    comparedWithout: [],
    page: same,
  },
]
