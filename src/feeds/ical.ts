/**
 * Reads the addresses of Luma events out of a calendar's iCal feed
 * (RFC 5545), and nothing else (D-60): no name, time or place is returned,
 * so none can be kept or shown.
 */
import { eventRefOf } from '../events/event-url'
import { trimEnd } from '../events/trim-end'
import { MAX_FEED_EVENTS } from './limits'

/** Lines of the feed with folded lines joined (RFC 5545 3.1). */
const unfolded = (text: string) =>
  text.replace(/\r?\n[ \t]/gu, '').split(/\r?\n/u)

/** A property's name, in upper case, and its value; parameters dropped. */
function propertyOf(line: string): Readonly<{ name: string; value: string }> {
  // The value starts at the first colon outside a quoted parameter.
  let quoted = false
  for (let at = 0; at < line.length; at += 1) {
    const char = line[at]
    if (char === '"') quoted = !quoted
    else if (char === ':' && !quoted) {
      const name = line.slice(0, at).split(';', 1)[0] ?? ''
      return { name: name.toUpperCase(), value: line.slice(at + 1) }
    }
  }
  return { name: '', value: '' }
}

/** A TEXT value with its escapes read (RFC 5545 3.3.11). */
const unescaped = (value: string) =>
  value.replace(/\\([\\;,nN])/gu, (_, char: string) =>
    char === 'n' || char === 'N' ? '\n' : char,
  )

// Addresses of Luma's two hosts, as they are written in running text.
const LUMA_ADDRESS =
  /https?:\/\/(?:www\.)?(?:lu\.ma|luma\.com)\/[^\s<>"'()[\]{}]+/giu

/** The longest line read; a longer one is no event's address and is skipped. */
export const MAX_LINE = 64 * 1024

/** The longest address read; a longer one is no Luma event. */
export const MAX_ADDRESS = 2048

const short = (address: string) => address.length <= MAX_ADDRESS

/** The Luma addresses in a property's value. */
function addressesIn(name: string, value: string): readonly string[] {
  if (name === 'URL') return [value.trim()].filter(short)
  if (name === 'DESCRIPTION' || name === 'LOCATION')
    return [...unescaped(value).matchAll(LUMA_ADDRESS)]
      .map(([found]) => found)
      .filter(short)
      .map((found) =>
        // A sentence may end right after the address.
        trimEnd(found, '.,;:!?'),
      )
  return []
}

/** Whether the text is an iCal calendar at all. */
export const isCalendar = (text: string) =>
  /^\uFEFF?BEGIN:VCALENDAR\r?$/mu.test(text.slice(0, 1024))

/**
 * The keys (D-22) of the Luma events a feed lists: read from each event's
 * `URL` line and from the addresses in its `DESCRIPTION` and `LOCATION`, as
 * where Luma puts them is not settled (D-69). Luma writes an event's name
 * address (`luma.com/<name>`) in its `DESCRIPTION` and its id address
 * (`luma.com/event/evt-…`) in its `LOCATION`; both are read. Addresses of
 * anything but a Luma event are left out. Each key once, in the order of
 * the feed, at most MAX_FEED_EVENTS.
 */
export function lumaEventKeys(text: string): readonly string[] {
  const keys = new Set<string>()
  for (const event of feedEvents(text))
    for (const key of keysOf(event)) {
      if (keys.size >= MAX_FEED_EVENTS) return [...keys]
      keys.add(key)
    }
  return [...keys]
}

/** One of an event's two addresses standing for the other (F33-AC20). */
export type LumaAlias = Readonly<{
  /** The key of its id address: `https://luma.com/event/evt-…`. */
  aliasKey: string
  /** The key of its name address: `https://luma.com/<name>`. */
  eventKey: string
}>

// The id of a Luma event as its `UID` writes it.
const LUMA_UID = /^(evt-[A-Za-z0-9]{1,64})@events\.lu\.ma$/u

/**
 * The events of a feed whose id and name are both known: each id key with
 * the one name key of the same event. An event with no name address, or
 * with more than one, gives none. At most MAX_FEED_EVENTS.
 */
export function lumaEventAliases(text: string): readonly LumaAlias[] {
  const aliases = new Map<string, string>()
  for (const event of feedEvents(text)) {
    const keys = keysOf(event)
    const names = keys.filter((key) => !isIdKey(key))
    const ids = new Set([...keys.filter(isIdKey), ...uidKeysOf(event)])
    if (names.length !== 1) continue
    for (const id of ids) {
      if (aliases.size >= MAX_FEED_EVENTS) break
      aliases.set(id, names[0]!)
    }
  }
  return [...aliases].map(([aliasKey, eventKey]) => ({ aliasKey, eventKey }))
}

const ID_KEY_PREFIX = 'https://luma.com/event/'

/** Whether a Luma key is of an event's id address. */
const isIdKey = (key: string) => key.startsWith(ID_KEY_PREFIX)

/** The Luma event keys of one event's properties, each once. */
function keysOf(event: readonly Property[]): readonly string[] {
  const keys = new Set<string>()
  for (const { name, value } of event)
    for (const address of addressesIn(name, value)) {
      const key = lumaKeyOf(address)
      if (key !== null) keys.add(key)
    }
  return [...keys]
}

/** The id key its `UID` gives an event, when it is Luma's. */
const uidKeysOf = (event: readonly Property[]) =>
  event
    .filter((property) => property.name === 'UID')
    .map((property) => LUMA_UID.exec(property.value.trim())?.[1])
    .filter((id) => id !== undefined)
    .map((id) => `${ID_KEY_PREFIX}${id}`)

/** The key of a Luma event's address, or null for anything else. */
function lumaKeyOf(address: string): string | null {
  const ref = eventRefOf(address)
  return ref?.service === 'luma' ? ref.key : null
}

const isEventBound = (name: string, value: string, bound: 'BEGIN' | 'END') =>
  name === bound && value.trim().toUpperCase() === 'VEVENT'

type Property = Readonly<{ name: string; value: string }>

/**
 * The feed's events, each as its properties, those of the calendar left
 * out. An event the feed leaves unended still counts.
 */
function* feedEvents(text: string): Generator<readonly Property[]> {
  let event: Property[] | null = null
  for (const line of unfolded(text)) {
    if (line.length > MAX_LINE) continue
    const property = propertyOf(line)
    if (isEventBound(property.name, property.value, 'BEGIN')) {
      if (event) yield event
      event = []
    } else if (isEventBound(property.name, property.value, 'END')) {
      if (event) yield event
      event = null
    } else event?.push(property)
  }
  if (event) yield event
}
