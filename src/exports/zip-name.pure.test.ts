import { describe, expect, it } from 'vitest'
import { zipFileName, zipNameProblem } from './zip-name'

describe('zipNameProblem', () => {
  it.each([
    'index.html',
    'assets/app.js',
    'a/b/c/d.css',
    '日本語/画像.png',
    '.well-known-not/x',
    'a..b/c',
    'a b/c d.html',
  ])(
    'Given the path %s, When checked, Then it may be an entry name',
    (path) => {
      expect(zipNameProblem(path)).toBeNull()
    },
  )

  it.each([
    ['', 'empty'],
    ['../evil.html', 'dot_segment'],
    ['a/../../evil.html', 'dot_segment'],
    ['a/./b', 'dot_segment'],
    ['..', 'dot_segment'],
    ['/etc/passwd', 'absolute_or_empty_segment'],
    ['a//b', 'absolute_or_empty_segment'],
    ['a/', 'absolute_or_empty_segment'],
    ['..\\evil', 'backslash'],
    ['a\\b', 'backslash'],
    ['C:/Windows/x', 'drive'],
    ['c:evil', 'drive'],
    ['a\u0000b', 'control_character'],
    ['a\nb', 'control_character'],
    ['a\u007fb', 'control_character'],
    ['e\u0301.html', 'not_normalized'],
    ['a'.repeat(0x10000), 'too_long'],
  ])(
    'Given the path %j, When checked, Then it is refused as %s',
    (path, problem) => {
      expect(zipNameProblem(path)).toBe(problem)
    },
  )
})

describe('zipFileName', () => {
  it('Given a slide and a version, When named, Then the name carries the URL name, the day and the version', () => {
    expect(
      zipFileName({
        slug: 'my-talk',
        deploymentId: '3f2b9c1e-aaaa-bbbb-cccc-1234567890ab',
        readyAt: Date.UTC(2026, 10, 26, 12) / 1000,
      }),
    ).toBe('my-talk-20261126-3f2b9c1e.zip')
  })

  it.each([
    ['evil"\r\nX: y', 'evil---x--y'],
    ['日本語', '---'],
    ['', 'slide'],
  ])(
    'Given the odd URL name %j, When named, Then only letters, digits and hyphens are left',
    (slug, expected) => {
      const name = zipFileName({
        slug,
        deploymentId: 'abcdef012345',
        readyAt: 0,
      })
      expect(name).toMatch(/^[a-z0-9-]+-19700101-abcdef01\.zip$/)
      expect(name.startsWith(`${expected}-`)).toBe(true)
    },
  )
})
