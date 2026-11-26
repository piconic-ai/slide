// The email addresses written in a text whose domain could be someone's real
// one (F43-AC16). Fixtures and demo data use addresses on domains that cannot
// be registered, so that no test, script or demo can write to a person. Pure.

/**
 * `local@domain`, the domain ending in a word of letters (not `pkg@1.2.3`).
 * The local part may end in `}`, the end of a template's `${login}`.
 */
const ADDRESS =
  /[A-Za-z0-9._%+}-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g

/** The user and password of a URL, which is written like an address. */
const USERINFO = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@"'`]*@/gi

/** Domains that are reserved (RFC 2606, RFC 6761): a name, or any name under it. */
const RESERVED_NAMES = ['example.com', 'example.org', 'example.net']
const RESERVED_TOPS = ['example', 'test', 'invalid']

/** True when the domain is reserved, so that it is nobody's. */
export function isReservedDomain(domain) {
  const name = domain.toLowerCase().replace(/\.$/, '')
  return (
    RESERVED_NAMES.some(
      (reserved) => name === reserved || name.endsWith(`.${reserved}`),
    ) || RESERVED_TOPS.some((top) => name === top || name.endsWith(`.${top}`))
  )
}

/** The addresses in a text on a domain that is not reserved, with their lines. */
export function realDomainAddresses(text) {
  const found = []
  text.split('\n').forEach((line, index) => {
    for (const match of line.replace(USERINFO, '').matchAll(ADDRESS))
      if (!isReservedDomain(match[1]))
        found.push({ line: index + 1, address: match[0] })
  })
  return found
}
