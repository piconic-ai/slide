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
  if (name === 'DESCRIPTION')
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
 * `URL` line and from the addresses in its `DESCRIPTION`, as where Luma
 * puts them is not settled (D-69). Addresses of anything but a
 * Luma event are left out. Each key once, in the order of the feed, at most
 * MAX_FEED_EVENTS.
 */
export function lumaEventKeys(text: string): readonly string[] {
  const keys = new Set<string>()
  for (const { name, value } of eventProperties(text))
    for (const address of addressesIn(name, value)) {
      if (keys.size >= MAX_FEED_EVENTS) return [...keys]
      const key = lumaKeyOf(address)
      if (key !== null) keys.add(key)
    }
  return [...keys]
}

/** The key of a Luma event's address, or null for anything else. */
function lumaKeyOf(address: string): string | null {
  const ref = eventRefOf(address)
  return ref?.service === 'luma' ? ref.key : null
}

const isEventBound = (name: string, value: string, bound: 'BEGIN' | 'END') =>
  name === bound && value.trim().toUpperCase() === 'VEVENT'

/** The properties of the feed's events, those of the calendar left out. */
function* eventProperties(
  text: string,
): Generator<Readonly<{ name: string; value: string }>> {
  let inEvent = false
  for (const line of unfolded(text)) {
    if (line.length > MAX_LINE) continue
    const property = propertyOf(line)
    if (isEventBound(property.name, property.value, 'BEGIN')) inEvent = true
    else if (isEventBound(property.name, property.value, 'END')) inEvent = false
    else if (inEvent) yield property
  }
}
