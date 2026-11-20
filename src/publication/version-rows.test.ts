import { describe, expect, test } from 'vitest'
import { versionRows } from './version-rows'

const a = { deploymentId: 'a', createdAt: 10 }
const b = { deploymentId: 'b', createdAt: 20 }

describe('versionRows', () => {
  test('F02-AC10: Given a public version and nothing newer, When the rows are made, Then there is the one row of the version readers see, with no button', () => {
    expect(versionRows({ kind: 'public', deploymentId: 'a' }, a, a)).toEqual([
      { kind: 'visible', version: a, action: 'none' },
    ])
  })

  test('F02-AC11: Given a public version and a newer one, When the rows are made, Then the newer version follows, with the button that publishes it', () => {
    expect(versionRows({ kind: 'public', deploymentId: 'a' }, a, b)).toEqual([
      { kind: 'visible', version: a, action: 'none' },
      { kind: 'newer', version: b, action: 'publish' },
    ])
  })

  test('F02-AC14: Given the newer version was published, When the rows are made, Then there is one row again', () => {
    expect(versionRows({ kind: 'public', deploymentId: 'b' }, b, b)).toEqual([
      { kind: 'visible', version: b, action: 'none' },
    ])
  })

  test('F02-AC12: Given nothing is published, When the rows are made, Then the newest version is the one row, with the button that publishes it', () => {
    expect(versionRows({ kind: 'draft' }, null, b)).toEqual([
      { kind: 'unpublished', version: b, action: 'publish' },
    ])
  })

  test('F02-AC12: Given publishing is stopped, When the rows are made, Then the version readers lost comes first with "publish again", and a newer one follows', () => {
    expect(versionRows({ kind: 'paused', resumeTo: 'a' }, a, b)).toEqual([
      { kind: 'stopped', version: a, action: 'resume' },
      { kind: 'newer', version: b, action: 'publish' },
    ])
    expect(versionRows({ kind: 'paused', resumeTo: 'a' }, a, a)).toEqual([
      { kind: 'stopped', version: a, action: 'resume' },
    ])
  })

  test('F02-AC12: Given publishing was stopped before anything was public, When the rows are made, Then the newest version is the one stopped row, published by a publish', () => {
    expect(versionRows({ kind: 'paused', resumeTo: null }, null, b)).toEqual([
      { kind: 'stopped', version: b, action: 'publish' },
    ])
  })

  test.each([
    ['a draft', { kind: 'draft' }],
    ['stopped', { kind: 'paused', resumeTo: null }],
  ] as const)(
    'Given %s and nothing received, When the rows are made, Then there is none',
    (_, publication) => {
      expect(versionRows(publication, null, null)).toEqual([])
    },
  )

  test('Given a public pointer whose version cannot be read, When the rows are made, Then there is none', () => {
    expect(versionRows({ kind: 'public', deploymentId: 'a' }, null, b)).toEqual(
      [],
    )
  })
})
