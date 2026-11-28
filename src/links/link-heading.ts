import { sourceUrlOf, type EventService } from '../events/event-url'
import type { Lang } from '../site/i18n'

/** The parts of an event its heading and its way out are made of. */
export type NamedEvent = Readonly<{
  service: EventService
  ref: string
  host: string
  /** Its own address (`events.url`). */
  url: string
  /** The name it was given while names were kept (F45-AC11); null for none. */
  name: string | null
  /**
   * The title of the oldest titled link to it on a public slide (F45-AC10);
   * null for none. A draft's title is never here.
   */
  firstTitle: string | null
}>

const SERVICE_NAMES: Readonly<Record<Exclude<EventService, 'web'>, string>> = {
  connpass: 'connpass',
  doorkeeper: 'Doorkeeper',
  luma: 'Luma',
}

/** The name of the site a link leads to: the service, or the host elsewhere. */
export const siteNameOf = (link: Pick<NamedEvent, 'service' | 'host'>) =>
  link.service === 'web' ? link.host : SERVICE_NAMES[link.service]

/**
 * The heading of the page of links of an address: the name kept for it, or
 * the first title saved on a public slide, or the site and the address
 * ("connpass https://connpass.com/event/410635/"). The same in every
 * language.
 */
export const headingOf = (
  link: Pick<NamedEvent, 'service' | 'host' | 'url' | 'name' | 'firstTitle'>,
): string => link.name ?? link.firstTitle ?? `${siteNameOf(link)} ${link.url}`

/** The words of the link to the address's own page ("connpass で見る"). */
export const sourceLinkTextOf = (
  link: Pick<NamedEvent, 'service' | 'host'>,
  lang: Lang,
) =>
  lang === 'ja' ? `${siteNameOf(link)} で見る` : `View on ${siteNameOf(link)}`

/**
 * What is gathered at an address, as far as its way out needs: an event,
 * with the host its oldest link on a public slide was written with, or any
 * other link, with the oldest such link's sanitized address.
 */
export type Gathered =
  | Readonly<{
      kind: 'event'
      event: Pick<NamedEvent, 'service' | 'ref' | 'url'>
      firstLinkHost: string | null
    }>
  | Readonly<{ kind: 'link'; firstLinkUrl: string }>

/**
 * Where the page leads readers (F45-AC25): a connpass event under the group
 * its oldest link named, any other event at its own address, and any other
 * link where its oldest link leads.
 */
export const sourceOf = (gathered: Gathered): string =>
  gathered.kind === 'event'
    ? sourceUrlOf(gathered.event, gathered.firstLinkHost)
    : gathered.firstLinkUrl
