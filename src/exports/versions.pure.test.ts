import { describe, expect, it } from 'vitest'
import type { Publication } from '../publication/state'
import type { PointedVersion } from '../publication/store'
import { exportVersions } from './versions'

const v = (id: string, readyAt: number, order = readyAt): PointedVersion => ({
  deploymentId: id,
  readyAt,
  order,
})
const old = v('old', 100)
const mid = v('mid', 200)
const newest = v('new', 300)

const draft: Publication = { kind: 'draft' }
const pub = (deploymentId: string): Publication => ({
  kind: 'public',
  deploymentId,
})
const paused = (resumeTo: string | null): Publication => ({
  kind: 'paused',
  resumeTo,
})

describe('exportVersions', () => {
  it.each<
    [
      string,
      Publication,
      PointedVersion | null,
      PointedVersion | null,
      string | null,
      string | null,
    ]
  >([
    ['nothing received', draft, null, null, null, null],
    ['received, never published', draft, null, newest, null, 'new'],
    ['published, nothing newer', pub('mid'), mid, mid, 'mid', null],
    ['published, a newer one prepared', pub('mid'), mid, newest, 'mid', 'new'],
    [
      'published, the newest is the published one',
      pub('new'),
      newest,
      newest,
      'new',
      null,
    ],
    ['stopped, nothing newer', paused('mid'), mid, mid, 'mid', null],
    ['stopped, a newer one prepared', paused('mid'), mid, newest, 'mid', 'new'],
    [
      'stopped without a version to bring back',
      paused(null),
      null,
      newest,
      null,
      'new',
    ],
  ])(
    'F35-AC4: Given %s, When the versions are chosen, Then published is %s and prepared is %s',
    (_name, publication, pointed, latest, published, prepared) => {
      const versions = exportVersions(publication, pointed, latest)
      expect(versions.published?.deploymentId ?? null).toBe(published)
      expect(versions.prepared?.deploymentId ?? null).toBe(prepared)
    },
  )

  it('F35-AC5: Given a slide with an old version too, When versions are chosen, Then no more than two come out and the old one is not among them', () => {
    const versions = exportVersions(pub('mid'), mid, newest)
    const ids = [versions.published, versions.prepared].map(
      (x) => x?.deploymentId,
    )
    expect(ids).not.toContain(old.deploymentId)
  })

  it('F35-AC4: Given two versions received in the same second, When chosen, Then the one put in later is the prepared one', () => {
    const a = v('a', 500, 1)
    const b = v('b', 500, 2)
    expect(exportVersions(pub('a'), a, b).prepared?.deploymentId).toBe('b')
    expect(exportVersions(pub('b'), b, b).prepared).toBeNull()
  })
})
