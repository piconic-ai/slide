import { describe, expect, test } from 'vitest'
import { deploymentOfUrl, deploymentOrigin, parseContentBase } from './origin'

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
