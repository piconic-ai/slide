import { describe, expect, test } from 'vitest'
import { fetchTarget, isRedirectStatus, MAX_REDIRECTS } from './title-policy'

const OWN = ['slide.example', 'content.example']
const allowed = (address: string) => fetchTarget(address, OWN) !== null

describe('fetchTarget', () => {
  test('F27-AC23: Given a public https address on the standard port, When checked, Then it may be asked', () => {
    expect(allowed('https://example.com/a?b=1#c')).toBe(true)
    expect(allowed('https://zenn.dev/x/articles/y')).toBe(true)
    expect(allowed('https://sub.example.co.jp:443/')).toBe(true)
    expect(allowed('https://日本語.jp/')).toBe(true)
  })

  test.each([
    ['http', 'http://example.com/'],
    ['javascript', 'javascript:alert(1)'],
    ['not an address', 'nope'],
    ['an IPv4 literal', 'https://93.184.216.34/'],
    ['a loopback IPv4', 'https://127.0.0.1/'],
    ['a private IPv4', 'https://10.0.0.1/'],
    ['the metadata address', 'https://169.254.169.254/latest/'],
    ['a decimal IPv4', 'https://2130706433/'],
    ['a hexadecimal IPv4', 'https://0x7f000001/'],
    ['an octal IPv4', 'https://0177.0.0.1/'],
    ['a short IPv4', 'https://127.1/'],
    ['an IPv6 literal', 'https://[2606:2800:220:1:248:1893:25c8:1946]/'],
    ['the IPv6 loopback', 'https://[::1]/'],
    ['an IPv4-mapped IPv6', 'https://[::ffff:127.0.0.1]/'],
    ['localhost', 'https://localhost/'],
    ['LOCALHOST in capitals', 'https://LOCALHOST/'],
    ['localhost with a dot', 'https://localhost./'],
    ['a name under .localhost', 'https://app.localhost/'],
    ['a .local name', 'https://printer.local/'],
    ['an .internal name', 'https://db.internal/'],
    ['a workers.dev name', 'https://slide.someone.workers.dev/'],
    ['a name under workers.dev', 'https://a.b.workers.dev/x'],
    ['workers.dev in capitals', 'https://SLIDE.Someone.Workers.Dev/'],
    ['a name under .internal', 'https://a.b.corp.internal/'],
    ['an .internal name with a dot', 'https://db.internal./'],
    ['a name with no dot', 'https://intranet/'],
    ['port 8443', 'https://example.com:8443/'],
    ['port 80', 'https://example.com:80/'],
    ['a user name', 'https://user@example.com/'],
    ['a password', 'https://user:pass@example.com/'],
  ])('F27-AC25: Given %s, When checked, Then it is not asked', (_, address) => {
    expect(allowed(address)).toBe(false)
  })

  test('F27-AC25: Given the service itself, its content domain and their subdomains, When checked, Then they are not asked', () => {
    expect(allowed('https://slide.example/@a/b')).toBe(false)
    expect(allowed('https://SLIDE.example/')).toBe(false)
    expect(allowed('https://d-1.content.example/')).toBe(false)
    expect(allowed('https://content.example/')).toBe(false)
    expect(allowed('https://www.slide.example/')).toBe(false)
    expect(allowed('https://slide.example./')).toBe(false)
  })

  test('F27-AC25: Given a name that only ends like the service, When checked, Then it may be asked', () => {
    expect(allowed('https://notslide.example/')).toBe(true)
    expect(allowed('https://slide.example.com/')).toBe(true)
  })

  test('F27-AC25: Given no host of its own known, When checked, Then public addresses may still be asked', () => {
    expect(fetchTarget('https://example.com/', [])).not.toBeNull()
  })
})

describe('redirects', () => {
  test('F27-AC26: Given the statuses of a redirect, When checked, Then 301, 302, 303, 307 and 308 are redirects, and no others', () => {
    for (const status of [301, 302, 303, 307, 308])
      expect(isRedirectStatus(status)).toBe(true)
    for (const status of [200, 204, 300, 304, 305, 306, 404, 500])
      expect(isRedirectStatus(status)).toBe(false)
    expect(MAX_REDIRECTS).toBe(3)
  })
})
