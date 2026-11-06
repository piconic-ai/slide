import { describe, expect, test } from 'vitest'
import { decideAccess, requestedFile } from './access'
import { SESSION_IDLE_SECONDS } from './lifetime'

describe('requestedFile', () => {
  test.each([
    ['/', 'index.html'],
    ['/index.html', 'index.html'],
    ['/assets/app.js', 'assets/app.js'],
    ['/docs/', 'docs/index.html'],
    ['/%E3%81%82.png', 'あ.png'],
  ])('Given %s, When resolved, Then it names %s', (path, file) => {
    expect(requestedFile(path)).toBe(file)
  })

  test.each([
    ['a parent segment', '/a/../index.html'],
    ['an encoded parent segment', '/a/%2E%2E/index.html'],
    ['a current segment', '/./index.html'],
    ['an empty segment', '//index.html'],
    ['the reserved prefix', '/_preview/launch'],
    ['broken percent encoding', '/%E3%81'],
  ])('Given %s, When resolved, Then nothing is named', (_, path) => {
    expect(requestedFile(path)).toBeNull()
  })
})

describe('decideAccess', () => {
  const live = { expiresAt: 1000 + SESSION_IDLE_SECONDS, hardExpiresAt: 50_000 }

  test('Given the public deployment, When anyone asks, Then it is public', () => {
    expect(
      decideAccess(
        { isPublic: true, session: null, presentedSession: false },
        1000,
      ),
    ).toEqual({ kind: 'public' })
  })

  test('Given a draft and a live owner session, When asked, Then the owner may read without a write', () => {
    expect(
      decideAccess(
        { isPublic: false, session: live, presentedSession: true },
        1000,
      ),
    ).toEqual({ kind: 'owner', renewTo: null })
  })

  test('Given a session past half its idle window, When asked, Then it is renewed', () => {
    const now = live.expiresAt - 60
    const access = decideAccess(
      { isPublic: false, session: live, presentedSession: true },
      now,
    )
    expect(access).toEqual({
      kind: 'owner',
      renewTo: now + SESSION_IDLE_SECONDS,
    })
  })

  test.each([
    ['idle expiry', live.expiresAt],
    ['the hard limit', 50_000],
  ])(
    'Given a session at %s, When asked, Then the owner is asked to reopen',
    (_, now) => {
      expect(
        decideAccess(
          {
            isPublic: false,
            session: { ...live, expiresAt: Math.max(live.expiresAt, now) },
            presentedSession: true,
          },
          now,
        ),
      ).toEqual({ kind: 'reopen' })
    },
  )

  test('Given a draft and no session, When anyone asks, Then it looks missing', () => {
    expect(
      decideAccess(
        { isPublic: false, session: null, presentedSession: false },
        1000,
      ),
    ).toEqual({ kind: 'not_found' })
  })

  test('Given a revoked session cookie, When used, Then the owner is asked to reopen', () => {
    expect(
      decideAccess(
        { isPublic: false, session: null, presentedSession: true },
        1000,
      ),
    ).toEqual({ kind: 'reopen' })
  })
})
