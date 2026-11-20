import { describe, expect, it } from 'vitest'
import {
  isRegisteredRedirect,
  MAX_CLIENT_NAME_LENGTH,
  MAX_REDIRECT_URI_LENGTH,
  parseClientRegistration,
  parseRedirectUri,
} from './client-registration'

describe('parseRedirectUri', () => {
  it.each([
    'https://agent.example/callback',
    'https://agent.example/callback?from=slide',
    'http://localhost:3000/callback',
    'http://127.0.0.1/callback',
    'http://[::1]:8080/cb',
  ])('Given %s, When it is read, Then it may be registered', (uri) => {
    expect(parseRedirectUri(uri)?.href).toBe(new URL(uri).href)
  })

  it.each([
    ['plain http on another host', 'http://agent.example/callback'],
    [
      'a host that only starts like localhost',
      'http://localhost.evil.example/cb',
    ],
    ['a fragment', 'https://agent.example/callback#token'],
    ['credentials', 'https://user:pass@agent.example/callback'],
    ['an app scheme', 'cursor://anysphere.cursor/oauth'],
    ['a script', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,hello'],
    ['a relative path', '/callback'],
    ['an empty string', ''],
    [
      'more than the longest URI',
      `https://a.example/${'a'.repeat(MAX_REDIRECT_URI_LENGTH)}`,
    ],
  ])('Given %s, When it is read, Then it is refused', (_, uri) => {
    expect(parseRedirectUri(uri)).toBeNull()
  })
})

describe('isRegisteredRedirect', () => {
  const registered = ['https://agent.example/cb', 'http://127.0.0.1:1234/cb']

  it('Given the registered string itself, When it is asked for, Then it matches', () => {
    expect(isRegisteredRedirect('https://agent.example/cb', registered)).toBe(
      true,
    )
  })

  it('Given a loopback URI on another port, When it is asked for, Then it matches', () => {
    expect(isRegisteredRedirect('http://127.0.0.1:50999/cb', registered)).toBe(
      true,
    )
    expect(isRegisteredRedirect('http://127.0.0.1/cb', registered)).toBe(true)
  })

  it.each([
    ['another path on the same host', 'https://agent.example/cb/other'],
    ['an added query', 'https://agent.example/cb?next=https://evil.example'],
    [
      'another port on a host that is not loopback',
      'https://agent.example:8443/cb',
    ],
    ['another loopback name', 'http://localhost:1234/cb'],
    ['another loopback path', 'http://127.0.0.1:1234/other'],
    [
      'a host that contains the registered one',
      'https://agent.example.evil.example/cb',
    ],
    ['something that is no URI', 'not a uri'],
  ])('Given %s, When it is asked for, Then it does not match', (_, uri) => {
    expect(isRegisteredRedirect(uri, registered)).toBe(false)
  })
})

describe('parseClientRegistration', () => {
  it('Given a name and redirect URIs, When the request is read, Then both are kept and repeats dropped', () => {
    expect(
      parseClientRegistration({
        client_name: '  Claude Code  ',
        redirect_uris: ['http://localhost:1/cb', 'http://localhost:1/cb'],
        token_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['implicit'],
      }),
    ).toEqual({
      ok: true,
      client: { name: 'Claude Code', redirectUris: ['http://localhost:1/cb'] },
    })
  })

  it('Given no name, When the request is read, Then the first redirect host names the client', () => {
    expect(
      parseClientRegistration({ redirect_uris: ['https://agent.example/cb'] }),
    ).toEqual({
      ok: true,
      client: {
        name: 'agent.example',
        redirectUris: ['https://agent.example/cb'],
      },
    })
  })

  it('Given a name with markup and an emoji, When the request is read, Then it is kept as written for the page to escape', () => {
    const name = '<script>alert(1)</script> 🙂'
    const result = parseClientRegistration({
      client_name: name,
      redirect_uris: ['https://agent.example/cb'],
    })
    expect(result).toMatchObject({ ok: true, client: { name } })
  })

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an array', []],
    ['no redirect URIs', { client_name: 'x' }],
    ['an empty list', { redirect_uris: [] }],
    ['a list that is no array', { redirect_uris: 'https://agent.example/cb' }],
    ['a URI that is no string', { redirect_uris: [1] }],
    [
      'six URIs',
      {
        redirect_uris: Array.from(
          { length: 6 },
          (_, i) => `https://a.example/${i}`,
        ),
      },
    ],
    [
      'one refused URI among good ones',
      { redirect_uris: ['https://a.example/cb', 'http://a.example/cb'] },
    ],
  ])(
    'Given %s, When the request is read, Then the redirect URIs are refused',
    (_, input) => {
      expect(parseClientRegistration(input)).toMatchObject({
        ok: false,
        error: 'invalid_redirect_uri',
      })
    },
  )

  it.each([
    ['an empty name', ''],
    ['only spaces', '   '],
    ['a name that is no string', 7],
    ['a null name', null],
    ['a control character', 'Agent\u0007'],
    ['a line break', 'Agent\nApproved by Slide'],
    ['a direction override', 'Agent‮evil'],
    ['a name longer than the limit', 'a'.repeat(MAX_CLIENT_NAME_LENGTH + 1)],
  ])(
    'Given %s, When the request is read, Then the name is refused',
    (_, name) => {
      expect(
        parseClientRegistration({
          client_name: name,
          redirect_uris: ['https://agent.example/cb'],
        }),
      ).toMatchObject({ ok: false, error: 'invalid_client_metadata' })
    },
  )

  it('Given a name of exactly the limit, When the request is read, Then it is kept', () => {
    const name = 'a'.repeat(MAX_CLIENT_NAME_LENGTH)
    expect(
      parseClientRegistration({
        client_name: name,
        redirect_uris: ['https://agent.example/cb'],
      }),
    ).toMatchObject({ ok: true, client: { name } })
  })
})
