/**
 * The links a community gathers slides by (D-32), read from what a person
 * typed. Nothing is asked of the sites: the address alone decides.
 */

import { groupOf } from '../events/event-url'
import {
  LUMA_CALENDAR_ID,
  LUMA_FEED_PATH,
  lumaFeedUrl,
} from '../feeds/luma-url'

/** The kinds of link a community may hold; `web` is the top of its own site. */
export const COMMUNITY_LINK_KINDS = [
  'connpass',
  'doorkeeper',
  'luma',
  'web',
] as const
export type CommunityLinkKind = (typeof COMMUNITY_LINK_KINDS)[number]

/** How many links one community may hold (D-31). */
export const MAX_COMMUNITY_LINKS = 10

/**
 * A link as the service keeps it. `url` is the one spelling it is stored and
 * compared as. `host` is what the hosts of events' links are matched against
 * (D-33); a Luma calendar has none, as its events come from its feed.
 */
export type CommunityLink =
  | Readonly<{
      kind: 'connpass' | 'doorkeeper' | 'web'
      url: string
      host: string
    }>
  | Readonly<{ kind: 'luma'; url: string; host: null }>

/** Why a typed link is refused. */
export type LinkRefusal =
  /** Not an http(s) address at all. */
  | 'invalid'
  /** A group's or a site's page other than its top. */
  | 'not_top'
  /** A site anyone uses (D-32): its host names no group. */
  | 'public_host'
  /** A Luma address that is not a calendar's iCal feed (D-05). */
  | 'luma_calendar'

export type LinkCheck =
  | Readonly<{ ok: true; link: CommunityLink }>
  | Readonly<{ ok: false; reason: LinkRefusal }>

/**
 * Sites anyone uses, whose host names nobody's group (D-32): a link to one
 * would gather every event on it. `www.` in front of one is the same site.
 * The design document lists the same.
 */
export const PUBLIC_HOSTS: ReadonlySet<string> = new Set([
  'connpass.com',
  'doorkeeper.jp',
  'luma.com',
  'lu.ma',
  'api.luma.com',
  'api.lu.ma',
  'peatix.com',
  'techplay.jp',
  'github.com',
  'gitlab.com',
  'x.com',
  'twitter.com',
  'facebook.com',
  'instagram.com',
  'threads.net',
  'bsky.app',
  'linkedin.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'discord.com',
  'discord.gg',
  'slack.com',
  'meetup.com',
  'eventbrite.com',
  'eventbrite.co.jp',
  'zoom.us',
  'speakerdeck.com',
  'slideshare.net',
  'docs.google.com',
  'google.com',
  'forms.gle',
  'notion.so',
  'notion.site',
  'note.com',
  'qiita.com',
  'zenn.dev',
  'medium.com',
  'hatenablog.com',
  'wikipedia.org',
  'slide.community',
  'microsoft.com',
  'live.com',
  'office.com',
  'sharepoint.com',
  'apple.com',
  'icloud.com',
  'amazon.com',
  'amazon.co.jp',
  'yahoo.co.jp',
  'line.me',
  'mixi.jp',
  'hatena.ne.jp',
  'scrapbox.io',
  'cosense.io',
  'canva.com',
  'figma.com',
  'miro.com',
  'reddit.com',
  'pixiv.net',
  'nicovideo.jp',
  'twitch.tv',
  'vimeo.com',
  'wordpress.com',
  'blogspot.com',
  'tumblr.com',
  'substack.com',
  'dev.to',
  'stackoverflow.com',
  // Shortened addresses: anyone's link may sit behind them.
  't.co',
  'bit.ly',
  'goo.gl',
  'tinyurl.com',
  'ow.ly',
  'buff.ly',
  'is.gd',
  'amzn.to',
  'lnkd.in',
  'x.gd',
])

/**
 * Subdomains connpass and Doorkeeper keep for themselves: such a host names
 * no group (`www.connpass.com/event/1/` is an event of no group), so it is
 * refused as a site anyone uses.
 */
export const SERVICE_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www',
  'api',
  'm',
  'help',
  'blog',
  'support',
  'docs',
  'status',
  'static',
  'media',
  'img',
  'images',
  'cdn',
  'assets',
  'app',
  'admin',
  'mail',
  'manage',
  'dev',
  'test',
  'staging',
])

// One label of a host name.
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u

const isHostName = (host: string) =>
  host.length <= 253 &&
  host.includes('.') &&
  host.split('.').every((label) => LABEL.test(label))

/**
 * Whether a host is a site anyone uses or under one: any subdomain of a
 * listed host counts (`sites.google.com`, `gist.github.com`), so no community
 * gathers the events of everyone on it.
 */
export const isPublicHost = (host: string) =>
  [...PUBLIC_HOSTS].some(
    (listed) => host === listed || host.endsWith(`.${listed}`),
  )

const parse = (text: string): URL | null => {
  if (!/^https?:\/\//iu.test(text)) return null
  try {
    return new URL(text)
  } catch {
    return null
  }
}

const refused = (reason: LinkRefusal): LinkCheck => ({ ok: false, reason })

/** How a Luma calendar's feed is written, for the pages that explain it. */
export const LUMA_FEED_FORM =
  'https://api.luma.com/ics/get?entity=calendar&id=cal-…'

/** A Luma calendar's iCal feed, as https://api.luma.com/ics/get?entity=calendar&id=cal-… */
function lumaLink(url: URL): LinkCheck {
  const id = url.searchParams.get('id') ?? ''
  if (
    url.pathname !== LUMA_FEED_PATH ||
    url.searchParams.get('entity') !== 'calendar' ||
    !LUMA_CALENDAR_ID.test(id)
  )
    return refused('luma_calendar')
  return {
    ok: true,
    link: {
      kind: 'luma',
      url: lumaFeedUrl(id),
      host: null,
    },
  }
}

/** The top of a group's or a site's page, its query and fragment dropped. */
function topLink(url: URL, host: string): LinkCheck {
  if (url.pathname !== '/') return refused('not_top')
  const group = (domain: string) => {
    const name = groupOf(host, domain)
    return name !== null && !SERVICE_SUBDOMAINS.has(name)
  }
  const kind = group('connpass.com')
    ? 'connpass'
    : group('doorkeeper.jp')
      ? 'doorkeeper'
      : 'web'
  if (kind === 'web' && isPublicHost(host)) return refused('public_host')
  return { ok: true, link: { kind, url: `https://${host}/`, host } }
}

/**
 * Reads one typed link (D-32): a connpass group (`https://<group>.connpass.com/`),
 * a Doorkeeper group (`https://<group>.doorkeeper.jp/`), a Luma calendar's iCal
 * feed (D-05), or the top of a site of one's own (`https://<host>/`). It is
 * kept in https, its host in lower case, and without a query or a fragment
 * (a Luma feed keeps its calendar alone). An address with a user, a password
 * or a port is not a link anyone shares, and is refused as invalid.
 */
export function checkCommunityLink(input: string): LinkCheck {
  const url = parse(input.trim())
  if (!url || url.username !== '' || url.password !== '' || url.port !== '')
    return refused('invalid')
  const host = url.hostname.toLowerCase().replace(/\.$/u, '')
  if (!isHostName(host)) return refused('invalid')
  // Luma once wrote its feeds under api.lu.ma; such a link is kept as the
  // api.luma.com one it now hands out.
  if (host === 'api.luma.com' || host === 'api.lu.ma') return lumaLink(url)
  if (host === 'luma.com' || host === 'lu.ma' || host === 'www.luma.com')
    return refused('luma_calendar')
  return topLink(url, host)
}

/** One field of the list of links, as the form shows it again. */
export type LinkField = Readonly<{
  /** What was typed, kept as it was so it is not lost. */
  value: string
  problem: LinkRefusal | null
}>

/** What a form's list of links reads as. */
export type LinksCheck =
  | Readonly<{
      ok: true
      links: readonly CommunityLink[]
      fields: readonly LinkField[]
    }>
  | Readonly<{
      ok: false
      /** None at all, or more than MAX_COMMUNITY_LINKS. */
      list: 'none' | 'too_many' | null
      fields: readonly LinkField[]
    }>

/**
 * Reads the list of links of a form. Empty fields are left out; the same
 * link typed twice is kept once. At least one link and at most
 * MAX_COMMUNITY_LINKS are needed (D-31). Every field keeps what was typed,
 * with its problem, so the form can show it again.
 */
export function checkCommunityLinks(inputs: readonly string[]): LinksCheck {
  const typed = inputs.filter((value) => value.trim() !== '')
  const checks = typed.map((value) => ({
    value,
    check: checkCommunityLink(value),
  }))
  const fields = checks.map(({ value, check }) => ({
    value,
    problem: check.ok ? null : check.reason,
  }))
  const links = [
    ...new Map(
      checks.flatMap(({ check }) =>
        check.ok ? [[check.link.url, check.link] as const] : [],
      ),
    ).values(),
  ]
  const list =
    typed.length === 0
      ? 'none'
      : links.length > MAX_COMMUNITY_LINKS
        ? 'too_many'
        : null
  if (list !== null || fields.some((field) => field.problem !== null))
    return { ok: false, list, fields }
  return { ok: true, links, fields }
}
