import { describe, expect, it } from 'vitest'
import { bearerOf, challengeOf, isAllowedOrigin } from './access'

describe('bearerOf', () => {
  it('Given a bearer header, When it is read, Then the token is returned', () => {
    expect(bearerOf('Bearer slide_at_abc-DEF_123')).toBe('slide_at_abc-DEF_123')
  })

  it.each([
    ['no header', undefined],
    ['an empty header', ''],
    ['another scheme', 'Basic dXNlcjpwYXNz'],
    ['a lowercase scheme', 'bearer abc'],
    ['no token', 'Bearer '],
    ['two tokens', 'Bearer abc def'],
    ['a token with a line break', 'Bearer abc\r\nX-Injected: 1'],
    ['a token longer than any issued', `Bearer ${'a'.repeat(513)}`],
  ])('Given %s, When it is read, Then there is no token', (_, header) => {
    expect(bearerOf(header)).toBeNull()
  })
})

describe('isAllowedOrigin', () => {
  const own = 'https://slide.example'

  it.each([
    ['no Origin header', undefined],
    ['the service’s own origin', own],
    ['a desktop app’s scheme', 'app://obsidian.md'],
  ])(
    'Given %s, When it is checked, Then the request may go on',
    (_, origin) => {
      expect(isAllowedOrigin(origin, own)).toBe(true)
    },
  )

  it.each([
    ['another site', 'https://evil.example'],
    ['the same host over http', 'http://slide.example'],
    ['the same host on another port', 'https://slide.example:8443'],
    [
      'a host that starts with the service’s',
      'https://slide.example.evil.example',
    ],
    ['an uppercase scheme', 'HTTPS://evil.example'],
    ['an opaque origin', 'null'],
  ])(
    'Given %s, When it is checked, Then the request is refused',
    (_, origin) => {
      expect(isAllowedOrigin(origin, own)).toBe(false)
    },
  )
})

describe('challengeOf', () => {
  it('Given a request without a token, When it is challenged, Then the challenge names the metadata and the scope, and no error', () => {
    expect(challengeOf('https://slide.example', false)).toBe(
      'Bearer resource_metadata="https://slide.example/.well-known/oauth-protected-resource/mcp", scope="slides:upload slides:export"',
    )
  })

  it('Given a token that is no good, When it is challenged, Then the challenge says invalid_token first', () => {
    expect(challengeOf('https://slide.example', true)).toMatch(
      /^Bearer error="invalid_token", resource_metadata="/,
    )
  })
})
