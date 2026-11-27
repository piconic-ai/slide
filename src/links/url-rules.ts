/**
 * The rules an address of a related link is compared by, as data: which query
 * names are left out, and how an address of each site is written when it is
 * compared. One place for them, next to the kinds (`kind-hosts.ts`), so a site
 * is added by adding an entry. The decisions behind every entry are in the
 * spec of related links (F27, the table of normalization rules).
 *
 * The migrations that build the compared form of the links already kept
 * repeat these rules in SQL. A change here needs a migration that builds the
 * form again. The key links are gathered by (`gather.ts`, F45) is built from
 * the same rules and kept as `gather_key`: a change to any rule here, or to
 * `gatheredWithout`, needs a migration that builds `gather_key` again too.
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
  /**
   * Query names left out only when links are gathered on one page (F45-AC5):
   * where a video starts. They stay in the compared form, so one slide can
   * keep two starts of one video (F27-AC74, F27-AC77).
   */
  gatheredWithout: readonly string[]
  /** The page an address of the site is compared as. */
  page: (page: ComparedPage) => ComparedPage
}>

/** The value of the first `name=` part of a query, or null when there is none. */
export const queryValue = (
  query: readonly string[],
  name: string,
): string | null => {
  const part = query.find((one) => one.startsWith(`${name}=`))
  return part === undefined ? null : part.slice(name.length + 1)
}

const without = (query: readonly string[], name: string) =>
  query.filter((one) => one !== name && !one.startsWith(`${name}=`))

const same = (page: ComparedPage) => page

const YOUTUBE_PATH = /^\/(?:shorts|live|embed)\/([\w-]+)$/u
const YOUTU_BE_PATH = /^\/([\w-]+)$/u

/** The id of a YouTube video the page shows, or null for any other page. */
function youTubeVideo(page: ComparedPage): string | null {
  if (page.host === 'youtu.be')
    return YOUTU_BE_PATH.exec(page.path)?.[1] ?? null
  if (page.path === '/watch') {
    const id = queryValue(page.query, 'v')
    return id !== null && /^[\w-]+$/u.test(id) ? id : null
  }
  return YOUTUBE_PATH.exec(page.path)?.[1] ?? null
}

const VIMEO_PATH = /^\/(\d+)(?:\/([0-9A-Za-z]+))?$/u
const VIMEO_PLAYER_PATH = /^\/video\/(\d+)$/u

/** A Vimeo video as `vimeo.com/<id>`, with its private hash as `h`. */
function vimeoPage(page: ComparedPage): ComparedPage {
  const match = (
    page.host === 'player.vimeo.com' ? VIMEO_PLAYER_PATH : VIMEO_PATH
  ).exec(page.path)
  if (!match) return page
  const hash = match[2] ?? queryValue(page.query, 'h')
  const query = without(page.query, 'h')
  return {
    ...page,
    host: 'vimeo.com',
    path: `/${match[1]}`,
    query: hash === null || hash === '' ? query : [...query, `h=${hash}`],
  }
}

const NICO_MS_PATH = /^\/((?:sm|so|nm)\d+)$/u

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
    gatheredWithout: [],
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
    gatheredWithout: [],
    page: (page) => ({
      ...page,
      host: 'luma.com',
      path: page.path.toLowerCase(),
    }),
  },
  {
    // YouTube: a video is its id, whatever form the address takes. `t` stays:
    // another start is another link (F27-AC73, F27-AC74). YouTube Music is
    // another site (F27-AC75).
    hosts: ['youtube.com', 'm.youtube.com', 'youtu.be'],
    subdomains: false,
    hrefDroppedQuery: [],
    comparedWithout: ['si', 'feature', 'pp'],
    gatheredWithout: ['t'],
    page: (page) => {
      const id = youTubeVideo(page)
      return id === null
        ? page
        : {
            ...page,
            host: 'youtube.com',
            path: '/watch',
            query: [...without(page.query, 'v'), `v=${id}`],
          }
    },
  },
  {
    // ニコニコ動画: a video is its id. `from` stays (F27-AC76, F27-AC77).
    hosts: ['nicovideo.jp', 'sp.nicovideo.jp', 'nico.ms'],
    subdomains: false,
    hrefDroppedQuery: [],
    comparedWithout: [],
    gatheredWithout: ['from'],
    page: (page) => {
      if (page.host !== 'nico.ms')
        return page.path.startsWith('/watch/')
          ? { ...page, host: 'nicovideo.jp' }
          : page
      const id = NICO_MS_PATH.exec(page.path)?.[1]
      return id === undefined
        ? page
        : { ...page, host: 'nicovideo.jp', path: `/watch/${id}` }
    },
  },
  {
    // Vimeo: a video is its id and its private hash (F27-AC78, F27-AC79).
    hosts: ['vimeo.com', 'player.vimeo.com'],
    subdomains: false,
    hrefDroppedQuery: [],
    comparedWithout: [],
    gatheredWithout: [],
    page: vimeoPage,
  },
  {
    // Twitch: the mobile host is the same site (F27-AC80).
    hosts: ['twitch.tv', 'm.twitch.tv'],
    subdomains: false,
    hrefDroppedQuery: [],
    comparedWithout: [],
    gatheredWithout: [],
    page: (page) => ({ ...page, host: 'twitch.tv' }),
  },
  {
    // Loom: the embedded player shows the shared video (F27-AC81).
    hosts: ['loom.com'],
    subdomains: false,
    hrefDroppedQuery: [],
    comparedWithout: [],
    gatheredWithout: [],
    page: (page) => ({
      ...page,
      path: page.path.replace(/^\/embed\/([^/]+)$/u, '/share/$1'),
    }),
  },
  {
    // Medium: `source` tells the post where a reader came from (F27-AC61,
    // F27-AC82).
    hosts: ['medium.com'],
    subdomains: true,
    hrefDroppedQuery: ['source'],
    comparedWithout: [],
    gatheredWithout: [],
    page: same,
  },
]
