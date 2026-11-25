import { describe, expect, test } from 'vitest'
import {
  FACE_ASKED_AGAIN,
  FACE_KEPT,
  faceCacheControl,
  facePath,
  faceSourceOf,
  faceVersion,
  type FaceFacts,
  type FaceSource,
} from './face'

const facts = (over: Partial<FaceFacts>): FaceFacts => ({
  uploadedAt: null,
  useGravatar: true,
  gravatarAt: null,
  ...over,
})

describe('F28-AC101: faceSourceOf', () => {
  test.each<[string, Partial<FaceFacts>, FaceSource]>([
    [
      'an upload, with Gravatar on and asked',
      { uploadedAt: 5, gravatarAt: 9 },
      { kind: 'uploaded', at: 5 },
    ],
    [
      'an upload, with Gravatar off',
      { uploadedAt: 5, useGravatar: false },
      { kind: 'uploaded', at: 5 },
    ],
    [
      'an upload at time 0',
      { uploadedAt: 0, useGravatar: false },
      { kind: 'uploaded', at: 0 },
    ],
    [
      'no upload, Gravatar on and asked',
      { gravatarAt: 9 },
      { kind: 'gravatar', at: 9 },
    ],
    [
      'no upload, Gravatar asked at time 0',
      { gravatarAt: 0 },
      { kind: 'gravatar', at: 0 },
    ],
    [
      'no upload, Gravatar on and never asked',
      {},
      { kind: 'gravatar', at: null },
    ],
    [
      'no upload, Gravatar off though a time is left',
      { useGravatar: false, gravatarAt: 9 },
      { kind: 'none' },
    ],
    ['no upload, Gravatar off', { useGravatar: false }, { kind: 'none' }],
  ])(
    'D-31: Given %s, When the face is decided, Then it is the one the order gives',
    (_, given, source) => {
      expect(faceSourceOf(facts(given))).toEqual(source)
    },
  )
})

describe('F28-AC101: faceVersion and facePath', () => {
  const sources: FaceSource[] = [
    { kind: 'uploaded', at: 1795561678000 },
    { kind: 'uploaded', at: 1795561678001 },
    { kind: 'uploaded', at: 0 },
    { kind: 'gravatar', at: 1795561678000 },
    { kind: 'gravatar', at: 0 },
    { kind: 'gravatar', at: null },
    { kind: 'none' },
  ]

  test('F28-AC101: Given faces that differ by their source or their time, When their versions are made, Then no two are the same, even for the same time', () => {
    const versions = sources.map(faceVersion)
    expect(new Set(versions).size).toBe(sources.length)
  })

  test('F28-AC101: Given the same face twice, When its version is made, Then it is the same, so a page drawn again names the address it named before', () => {
    for (const source of sources)
      expect(faceVersion(structuredClone(source))).toBe(faceVersion(source))
  })

  test.each(sources)(
    'F28-AC49 F28-AC101: Given the face %o, When its address is made, Then it is the path by id with the version, and nothing else in its query',
    (source) => {
      const address = new URL(facePath('722500', source), 'https://x.example')
      expect(address.pathname).toBe('/avatars/722500')
      expect([...address.searchParams]).toEqual([['v', faceVersion(source)]])
      // A version is letters and digits only, nothing to escape.
      expect(faceVersion(source)).toMatch(/^[a-z][0-9]*$/)
    },
  )
})

describe('F28-AC101: faceCacheControl', () => {
  const uploaded: FaceSource = { kind: 'uploaded', at: 1795561678000 }
  const gravatar: FaceSource = { kind: 'gravatar', at: 1795561678 }
  test.each<[string, string | undefined, FaceSource | null, string]>([
    ['its own version', 'u1795561678000', uploaded, FACE_KEPT],
    ['no version', undefined, uploaded, FACE_ASKED_AGAIN],
    ['an empty version', '', uploaded, FACE_ASKED_AGAIN],
    ['an earlier version', 'u1795561677999', uploaded, FACE_ASKED_AGAIN],
    ['a version of another kind', 'g1795561678000', uploaded, FACE_ASKED_AGAIN],
    [
      'a Gravatar version with no time',
      'g',
      { kind: 'gravatar', at: 1 },
      FACE_ASKED_AGAIN,
    ],
    ['the version in capitals', 'U1795561678000', uploaded, FACE_ASKED_AGAIN],
    ['the version with a space', ' u1795561678000', uploaded, FACE_ASKED_AGAIN],
    ['the version of none, with nothing served', 'n', null, FACE_ASKED_AGAIN],
    ['no version, with nothing served', undefined, null, FACE_ASKED_AGAIN],
  ])(
    'F28-AC101: Given a face asked for under %s, When the answer says how long to keep it, Then it is kept long only for the version of what was served',
    (_, asked, served, cacheControl) => {
      expect(faceCacheControl(asked, served, 1795561678)).toBe(cacheControl)
    },
  )

  test.each<[string, number, string]>([
    ['just asked', 1795561678, 'public, max-age=86400'],
    ['asked an hour ago', 1795561678 + 3600, 'public, max-age=82800'],
    ['due to be asked again', 1795561678 + 86400, FACE_ASKED_AGAIN],
    ['past due', 1795561678 + 90000, FACE_ASKED_AGAIN],
    [
      'asked in the future (a clock moved back)',
      1795561678 - 10,
      'public, max-age=86400',
    ],
  ])(
    'F28-AC101: Given a Gravatar picture under its own version, %s, When the answer says how long to keep it, Then it is kept only until Gravatar is to be asked again, never as immutable',
    (_, now, cacheControl) => {
      expect(faceCacheControl('g1795561678', gravatar, now)).toBe(cacheControl)
    },
  )

  test('F28-AC101: Given the two answers, When they are read, Then one is kept a year without asking, and the other is asked for each time', () => {
    expect(FACE_KEPT).toBe('public, max-age=31536000, immutable')
    expect(FACE_ASKED_AGAIN).toBe('no-cache')
  })
})
