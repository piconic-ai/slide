import { describe, expect, test } from 'vitest'
import {
  deploymentOfUrl,
  deploymentOrigin,
  parseContentBase as parseWith,
  routeOfHost,
} from './origin'

const management = 'https://slide.example'
const parseContentBase = (value: string | undefined) =>
  parseWith(value, management)

const id = '0b6f0b55-8c43-4d0e-9a51-3c6a3f0f6a10'
const base = parseContentBase('https://slideusercontent.example') as URL

describe('parseContentBase', () => {
  test('Given no setting, When parsed, Then delivery is disabled', () => {
    expect(parseContentBase(undefined)).toBeNull()
    expect(parseContentBase('')).toBeNull()
  })

  test('Given local development, When parsed, Then http on localhost is allowed', () => {
    expect(parseContentBase('http://localhost:8794')?.host).toBe(
      'localhost:8794',
    )
  })

  test.each([
    ['plain http', 'http://slideusercontent.example'],
    ['a path', 'https://slideusercontent.example/files'],
    ['a query', 'https://slideusercontent.example/?x=1'],
    ['credentials', 'https://u@slideusercontent.example'],
    ['not a URL', 'slideusercontent'],
    ['a password', 'https://:p@slideusercontent.example'],
    ['the management host', 'https://slide.example'],
    ['a parent of the management host', 'https://example'],
    ['a subdomain of the management host', 'https://u.slide.example'],
  ])(
    'Given %s, When parsed, Then the configuration is rejected',
    (_, value) => {
      expect(() => parseContentBase(value)).toThrow()
    },
  )
})

describe('deploymentOrigin and deploymentOfUrl', () => {
  test('Given a deployment, When its origin is built, Then the URL maps back to it', () => {
    const origin = deploymentOrigin(base, id)
    expect(origin).toBe(`https://d-${id}.slideusercontent.example`)
    expect(deploymentOfUrl(base, new URL('/index.html', origin))).toBe(id)
  })

  test('Given a local base, When a localhost subdomain is used, Then the port is kept', () => {
    const local = parseContentBase('http://localhost:8794') as URL
    const origin = deploymentOrigin(local, id)
    expect(origin).toBe(`http://d-${id}.localhost:8794`)
    expect(deploymentOfUrl(local, new URL(origin))).toBe(id)
  })

  test('Given something that is not a deployment ID, When an origin is built, Then it is refused', () => {
    expect(() => deploymentOrigin(base, 'x.evil')).toThrow()
  })

  test.each([
    ['the service origin', 'https://slideusercontent.example/'],
    ['another domain', `https://d-${id}.evil.example/`],
    ['a lookalike suffix', `https://d-${id}.slideusercontent.example.evil/`],
    ['a nested label', `https://a.d-${id}.slideusercontent.example/`],
    ['plain http', `http://d-${id}.slideusercontent.example/`],
    ['another port', `https://d-${id}.slideusercontent.example:8443/`],
    ['no prefix', `https://${id}.slideusercontent.example/`],
    ['a bad ID', 'https://d-123.slideusercontent.example/'],
  ])('Given %s, When resolved, Then no deployment is addressed', (_, url) => {
    expect(deploymentOfUrl(base, new URL(url))).toBeNull()
  })
})

describe('routeOfHost', () => {
  const route = (url: string) => routeOfHost(base, management, new URL(url))

  test('Given the management host, When routed, Then the management app answers', () => {
    expect(route('https://slide.example/decks')).toEqual({ kind: 'management' })
  })

  test('Given a deployment origin, When routed, Then only content routes answer', () => {
    expect(route(`https://d-${id}.slideusercontent.example/`)).toEqual({
      kind: 'deployment',
      deploymentId: id,
    })
  })

  test.each([
    ['the content apex', 'https://slideusercontent.example/decks'],
    ['a trailing dot', `https://d-${id}.slideusercontent.example./decks`],
    ['an apex with a trailing dot', 'https://slideusercontent.example./decks'],
    ['another subdomain', 'https://www.slideusercontent.example/decks'],
    ['another port', `https://d-${id}.slideusercontent.example:8443/`],
  ])('Given %s, When routed, Then it stays on the content side', (_, url) => {
    expect(route(url)).toEqual({ kind: 'content_other' })
  })

  test('Given no content origin, When routed, Then everything is management', () => {
    expect(
      routeOfHost(null, management, new URL(`https://d-${id}.x.example/`)),
    ).toEqual({ kind: 'management' })
  })

  test('Given local development on one host, When routed, Then localhost is management and d-* is content', () => {
    const local = parseWith(
      'http://localhost:8794',
      'http://localhost:8794',
    ) as URL
    const at = (url: string) =>
      routeOfHost(local, 'http://localhost:8794', new URL(url)).kind
    expect(at('http://localhost:8794/decks')).toBe('management')
    expect(at(`http://d-${id}.localhost:8794/`)).toBe('deployment')
  })
})
