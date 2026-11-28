import type { Lang } from '../site/i18n'
import type { EventService } from '../events/event-url'

/** The parts of an event its name and its way out are made of. */
export type NamedEvent = Readonly<{
  service: EventService
  ref: string
  host: string
  /** The first title its links were saved with, or the operator's; null for none. */
  name: string | null
}>

const SERVICE_NAMES: Readonly<Record<Exclude<EventService, 'web'>, string>> = {
  connpass: 'connpass',
  doorkeeper: 'Doorkeeper',
  luma: 'Luma',
}

/** The name of the site an event is on: the service, or the host elsewhere. */
export const serviceNameOf = (event: Pick<NamedEvent, 'service' | 'host'>) =>
  event.service === 'web' ? event.host : SERVICE_NAMES[event.service]

/**
 * The name an event is shown with: its name, or, while none was given, the
 * service and the event within it ("connpass のイベント 410635"). Elsewhere
 * the event within it is the host and path.
 */
export function eventNameOf(event: NamedEvent, lang: Lang): string {
  if (event.name !== null) return event.name
  if (event.service === 'web')
    return lang === 'ja' ? `${event.ref} のイベント` : `Event at ${event.ref}`
  const service = serviceNameOf(event)
  return lang === 'ja'
    ? `${service} のイベント ${event.ref}`
    : `${service} event ${event.ref}`
}

/** The words of the link to the event's own page ("connpass で見る"). */
export const sourceLinkTextOf = (
  event: Pick<NamedEvent, 'service' | 'host'>,
  lang: Lang,
) =>
  lang === 'ja'
    ? `${serviceNameOf(event)} で見る`
    : `View on ${serviceNameOf(event)}`
