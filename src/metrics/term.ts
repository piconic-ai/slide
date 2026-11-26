/** The longest search word that is kept, in characters (D-73). */
export const MAX_TERM_CHARS = 50

const EMAIL = /@/
const IPV4 = /\b\d{1,3}(\.\d{1,3}){3}\b/
// Two or more colons between hex digits: an IPv6 address, or a time.
const IPV6 = /[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,}/i
const ADDRESS = /https?:|www\./i
// A token, a key or an id someone pasted into the box.
const SECRET = /[0-9a-z_-]{24,}/i

/**
 * A help search word as it may be kept (D-73), or null when it must not be.
 * Whitespace is collapsed and the word is cut to 50 characters, counted as
 * characters rather than UTF-16 units, so no emoji is cut in half. A word
 * that looks like an email address, an IP address, a web address or a token
 * is not kept at all: a person who types their own address into a search box
 * must not find it in the records (D-71). The check runs on the whole word
 * before it is cut, so cutting cannot hide the rest of an address.
 */
export function searchTermOf(raw: string): string | null {
  const word = raw.normalize('NFKC').replace(/\s+/gu, ' ').trim()
  if (word === '') return null
  if (
    EMAIL.test(word) ||
    IPV4.test(word) ||
    IPV6.test(word) ||
    ADDRESS.test(word) ||
    SECRET.test(word)
  )
    return null
  return [...word].slice(0, MAX_TERM_CHARS).join('')
}
