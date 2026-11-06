import { describe, expect, test } from 'vitest'
import {
  digestUploadInventory,
  MAX_UPLOAD_PATH_BYTES,
  parseInventoryStructure,
} from './inventory'
import { DEFAULT_UPLOAD_LIMITS, parseUploadLimits } from './limits'
import { inventoryRejection } from './rejections'

const hash = 'a'.repeat(64)
const file = (path: string, size = 1, sha256 = hash) => ({ path, size, sha256 })
const input = (...files: unknown[]) => ({ entry: 'index.html', files })
const entry = file('index.html', 10)

describe('upload inventory boundary', () => {
  test('accepts a static build and derives media types with canonical paths', () => {
    const parsed = parseInventoryStructure(
      input(file('assets/e\u0301.svg'), entry, file('app.JS')),
    )
    expect(parsed.files.map((item) => [item.path, item.mediaType])).toEqual([
      ['app.JS', 'text/javascript; charset=utf-8'],
      ['assets/é.svg', 'image/svg+xml'],
      ['index.html', 'text/html; charset=utf-8'],
    ])
    expect(parsed.totalBytes).toBe(12)
    expect(Object.isFrozen(parsed.files)).toBe(true)
    expect(Object.isFrozen(parsed.files[0])).toBe(true)
  })

  test.each([
    '/etc/passwd',
    '../index.html',
    'a/../b.js',
    './index.html',
    'a//b.js',
    'a/',
    'a\\b.js',
    'C:/index.html',
    'a%2fb.js',
    'a?.js',
    'a#.js',
    'a\0.js',
    'a\n.js',
    '.env',
    '.env.production',
    '.git/config.json',
    'a/.ssh/key.json',
    'node_modules/pkg/index.js',
    '__MACOSX/file.js',
    '_worker.js',
    '_routes.json',
    '_preview/index.html',
    '_preview/launch/index.html',
    'secrets.json',
    'credentials.json',
    'a.php',
    'a.php.html',
    'a.PHP8.js',
    'a.cgi.js',
    'index.md',
    'a.ts',
    'html',
    'a\ud800.js',
    'a\u202e.js',
    `${'é'.repeat(MAX_UPLOAD_PATH_BYTES / 2)}.js`,
  ])('rejects dangerous or unsupported path %j', (path) => {
    expect(() => parseInventoryStructure(input(entry, file(path)))).toThrow()
  })

  test('rejects duplicate normalized paths and file/directory collisions', () => {
    for (const files of [
      [entry, entry],
      [entry, file('é.js'), file('e\u0301.js')],
      [entry, file('a.js'), file('a.js-other.js'), file('a.js/child.js')],
    ])
      expect(() => parseInventoryStructure(input(...files))).toThrow()
    expect(
      parseInventoryStructure(input(entry, file('A.js'), file('a.js'))).files,
    ).toHaveLength(3)
  })

  test.each([
    null,
    [],
    {},
    { entry: 'slides.html', files: [file('slides.html')] },
    input(),
    input(file('app.js')),
    { ...input(entry), headers: {} },
    input({ ...entry, mediaType: 'text/plain' }),
    input({ ...entry, kind: 'symlink' }),
    input(file('index.html', -1)),
    input(file('index.html', 0.5)),
    input(file('index.html', Infinity)),
    input(file('index.html', Number.MAX_SAFE_INTEGER + 1)),
    input(file('index.html', 1, hash.toUpperCase())),
    input(file('index.html', 1, 'a'.repeat(63))),
  ])('rejects malformed metadata %j', (value) => {
    expect(() => parseInventoryStructure(value)).toThrow()
  })

  test('accepts a total at the safe integer limit and rejects one past it', () => {
    const max = Number.MAX_SAFE_INTEGER
    expect(
      parseInventoryStructure(input(file('index.html', max - 1), file('a.js')))
        .totalBytes,
    ).toBe(max)
    expect(() =>
      parseInventoryStructure(input(file('index.html', max), file('a.js'))),
    ).toThrow()
  })

  test('applies session limits exactly, including empty static files', () => {
    const limits = parseUploadLimits({
      fileBytes: 10,
      deploymentBytes: 12,
      files: 2,
    })
    const check = (...files: unknown[]) =>
      inventoryRejection(parseInventoryStructure(input(...files)), limits)
    expect(check(entry, file('app.js', 2))).toBeNull()
    expect(check(file('index.html', 0))).toBeNull()
    expect(check(file('index.html', 11))).toBe('file_too_large')
    expect(check(entry, file('app.js', 3))).toBe('deployment_too_large')
    expect(check(entry, file('a.js', 0), file('b.js', 0))).toBe(
      'too_many_files',
    )
  })

  test('hashes canonical metadata independently of enumeration and normalization', async () => {
    const first = parseInventoryStructure(input(file('e\u0301.js'), entry))
    const second = parseInventoryStructure(input(entry, file('é.js')))
    expect(await digestUploadInventory(first)).toBe(
      await digestUploadInventory(second),
    )
    expect(await digestUploadInventory(first)).toBe(
      '902e8049d8955213357a5e91b60dcd673f5ade377f1dd7caa8142bf632463d4e',
    )
    for (const changed of [
      file('other.js'),
      file('é.js', 2),
      file('é.js', 1, 'b'.repeat(64)),
    ]) {
      expect(
        await digestUploadInventory(
          parseInventoryStructure(input(entry, changed)),
        ),
      ).not.toBe(await digestUploadInventory(first))
    }
  })
})

describe('upload limit snapshots', () => {
  test('keeps documented defaults and applies partial overrides', () => {
    expect(DEFAULT_UPLOAD_LIMITS).toEqual({
      deploymentBytes: 10 * 1024 * 1024,
      fileBytes: 5 * 1024 * 1024,
      files: 100,
      authorBytes: 50 * 1024 * 1024,
      startsPerDay: 5,
      activeSessions: 1,
      refusalsPerDay: 20,
      sessionSeconds: 24 * 60 * 60,
      credentialSeconds: 60 * 60,
      orphanGraceSeconds: 60 * 60,
      receiveLeaseSeconds: 120,
    })
    const config = { files: 5 }
    const snapshot = parseUploadLimits(config)
    config.files = 10
    expect(snapshot.files).toBe(5)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(parseUploadLimits(JSON.parse(JSON.stringify(snapshot)))).toEqual(
      snapshot,
    )
  })

  test.each([
    0,
    -1,
    1.5,
    Infinity,
    NaN,
    Number.MAX_SAFE_INTEGER + 1,
    '10',
    null,
  ])('rejects invalid quota %j for every setting', (value) => {
    for (const key of Object.keys(DEFAULT_UPLOAD_LIMITS)) {
      expect(() => parseUploadLimits({ [key]: value })).toThrow()
    }
  })

  test.each([
    null,
    [],
    { unknown: 1 },
    { fileBytes: 11, deploymentBytes: 10 },
    { deploymentBytes: 60 * 1024 * 1024 },
    { sessionSeconds: 120 },
    { sessionSeconds: 60, receiveLeaseSeconds: 60 },
    { receiveLeaseSeconds: 29 },
    // The lease must stay shorter than the orphan grace period.
    { orphanGraceSeconds: 960, receiveLeaseSeconds: 960 },
    { files: 501 },
    { receiveLeaseSeconds: 15 * 60 + 1 },
  ])('rejects malformed or inconsistent configuration %j', (value) => {
    expect(() => parseUploadLimits(value)).toThrow()
  })
})
