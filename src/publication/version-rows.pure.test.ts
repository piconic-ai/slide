import { describe, expect, test } from 'vitest'
import { versionRows } from './version-rows'

const a = { deploymentId: 'a', readyAt: 10, order: 1 }
const b = { deploymentId: 'b', readyAt: 20, order: 2 }

describe('versionRows', () => {
  test('F02-AC11: Given a version received after the public one, whatever order the uploads started in, When the rows are made, Then it is the new version', () => {
    // Started first, received last: the public one was received at 10.
    expect(
      versionRows({ kind: 'public', deploymentId: 'a' }, a, {
        deploymentId: '0',
        readyAt: 15,
        order: 3,
      }),
    ).toEqual([
      { kind: 'visible', version: a, action: 'none' },
      {
        kind: 'newer',
        version: { deploymentId: '0', readyAt: 15, order: 3 },
        action: 'publish',
      },
    ])
  })

  test('F02-AC10: Given the newest received version is older than the public one, When the rows are made, Then there is no new version', () => {
    expect(versionRows({ kind: 'public', deploymentId: 'b' }, b, a)).toEqual([
      { kind: 'visible', version: b, action: 'none' },
    ])
  })

  test('F02-AC49: Given two versions received in the same second, When the rows are made, Then the one put in later is the newer, whatever their IDs and whichever is public', () => {
    // The IDs are random: the later version may have the smaller one.
    const x = { deploymentId: 'y', readyAt: 5, order: 1 }
    const y = { deploymentId: 'x', readyAt: 5, order: 2 }
    expect(
      versionRows({ kind: 'public', deploymentId: 'y' }, x, y),
    ).toHaveLength(2)
    expect(
      versionRows({ kind: 'public', deploymentId: 'x' }, y, y),
    ).toHaveLength(1)
    expect(
      versionRows({ kind: 'public', deploymentId: 'x' }, y, x),
    ).toHaveLength(1)
  })

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
