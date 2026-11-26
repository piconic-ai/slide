import { describe, expect, it } from 'vitest'
import { isReservedDomain, realDomainAddresses } from './fixture-addresses.mjs'

describe('F43-AC16: isReservedDomain', () => {
  it.each([
    'example.com',
    'example.org',
    'example.net',
    'mail.example.com',
    'a.b.example.org',
    'EXAMPLE.NET',
    'slide.example',
    'example',
    'mail.test',
    'x.y.test',
    'host.invalid',
    'example.com.',
    // An iCal event's UID from Luma (`evt-…@events.lu.ma`): an identifier.
    'events.lu.ma',
  ])('Given %s, Then it is reserved', (domain) => {
    expect(isReservedDomain(domain)).toBe(true)
  })

  it.each([
    'gmail.com',
    'slide.community',
    'example.co.jp',
    'notexample.com',
    'example.com.evil.net',
    'example.jp',
    'mytest.com',
    'x.test.com',
    // Only the UID's own domain is an identifier, not Luma's other names.
    'lu.ma',
    'luma.com',
    'x.events.lu.ma',
    'invalid.com',
    'testing',
  ])('Given %s, Then it is not', (domain) => {
    expect(isReservedDomain(domain)).toBe(false)
  })
})

describe('F43-AC16: realDomainAddresses', () => {
  it('Given addresses on reserved domains only, Then none is found', () => {
    expect(
      realDomainAddresses(
        `a@example.com b@x.example c@y.test d@z.invalid\nemail: \`\${login}@mail.example\``,
      ),
    ).toEqual([])
  })

  it('Given an address on a real domain, Then it is found with its line', () => {
    expect(realDomainAddresses('ok@example.com\nbad@gmail.com')).toEqual([
      { line: 2, address: 'bad@gmail.com' },
    ])
  })

  it('Given a template that builds an address on a real domain, Then it is found', () => {
    expect(realDomainAddresses('`${login}@gmail.com`')).toEqual([
      { line: 1, address: 'login}@gmail.com' },
    ])
  })

  it.each([
    ['a package version', 'react@18.3.1 and vitest@4.1.12'],
    ['a scoped package', "import x from '@barefootjs/hono'"],
    ['a handle', 'see /@owner/talk and @owner'],
    ['a URL with a user', 'https://user@api.lu.ma/ics'],
    ['a URL with a user and a password', "'https://a:b@kanagawa.pm/'"],
    ['a git remote written as a URL', 'ssh://git@github.com/org/repo.git'],
    ['no address at all', 'hello'],
    ['an empty text', ''],
  ])('Given %s, Then none is found', (_label, text) => {
    expect(realDomainAddresses(text)).toEqual([])
  })

  it('Given an address after a URL with a user on the same line, Then the address is still found', () => {
    expect(
      realDomainAddresses('https://u@host.example/ then me@gmail.com'),
    ).toEqual([{ line: 1, address: 'me@gmail.com' }])
  })

  it('Given the same address twice, Then both are found', () => {
    expect(realDomainAddresses('x@gmail.com x@gmail.com')).toHaveLength(2)
  })
})
