import { describe, expect, it } from 'vitest'
import { PAGE_SCRIPT_SRC } from '../../scripts/page-script.mjs'
import { LANGS } from '../site/i18n'
import { VERSION_LIMITS, type VersionLimits } from '../uploads/version-limits'
import { prepareDrop } from './browser'
import { planZip } from './plan'
import type { DropRefusal } from './precheck'
import { makeZip } from './test-zip'
import { refusalMessage } from './text'

const page = '<!doctype html><head><title>Zipped</title></head><body>z</body>'
const limits = { files: 3, fileBytes: 200, deploymentBytes: 300 }
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const planned = async (
  zip: Uint8Array,
  with_: VersionLimits = VERSION_LIMITS,
) => {
  const plan = await planZip(zip, with_)
  if (!plan.ok) throw new Error(`refused: ${JSON.stringify(plan.refusal)}`)
  return plan.files
}
const refusal = async (zip: Uint8Array, with_ = limits) => {
  const plan = await planZip(zip, with_)
  return plan.ok ? null : plan.refusal
}

describe('planZip', () => {
  it('F22-AC3: Given a zip with index.html, a stylesheet and an image at its top, When planned, Then every file is sent under its own path, and only the HTML gets the page script', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])
    const files = await planned(
      makeZip([
        { name: 'index.html', data: page },
        { name: 'css/site.css', data: 'h1{color:red}' },
        { name: 'img/photo.png', data: png, method: 0 },
      ]),
    )

    expect(files.map(({ path }) => path)).toEqual([
      'index.html',
      'css/site.css',
      'img/photo.png',
    ])
    expect(text(files[0]!.bytes).split(PAGE_SCRIPT_SRC).length - 1).toBe(1)
    expect(text(files[1]!.bytes)).toBe('h1{color:red}')
    expect([...files[2]!.bytes]).toEqual([...png])
    for (const file of files) expect(file.size).toBe(file.bytes.byteLength)
  })

  it('F22-AC4: Given a zip whose files are all in one folder, When planned, Then the folder is the root and its index.html is the first page', async () => {
    const files = await planned(
      makeZip([
        { name: 'my-talk/', data: '' },
        { name: 'my-talk/index.html', data: page },
        { name: 'my-talk/css/site.css', data: 'a{}' },
      ]),
    )

    expect(files.map(({ path }) => path)).toEqual([
      'index.html',
      'css/site.css',
    ])
    expect(text(files[0]!.bytes)).toContain('<title>Zipped</title>')
  })

  it('F22-AC5: Given a zip macOS made of one folder, When planned, Then __MACOSX and .DS_Store are left out and the folder is the root', async () => {
    const files = await planned(
      makeZip([
        { name: 'deck/index.html', data: page },
        { name: 'deck/.DS_Store', data: 'finder' },
        { name: '__MACOSX/deck/._index.html', data: 'fork' },
        { name: '__MACOSX/._deck', data: 'fork' },
      ]),
    )

    expect(files.map(({ path }) => path)).toEqual(['index.html'])
  })

  it.each([
    ['no index.html', [{ name: 'slides.html', data: page }]],
    ['index.html two folders down', [{ name: 'a/b/index.html', data: page }]],
    [
      'two folders',
      [
        { name: 'a/index.html', data: page },
        { name: 'b/index.html', data: page },
      ],
    ],
    ['no files', []],
  ])(
    'F22-AC5: Given a zip with %s, When planned, Then it is refused because no index.html decides the first page',
    async (_name, entries) => {
      expect(await refusal(makeZip(entries))).toEqual({ reason: 'no_index' })
    },
  )

  it('F22-AC6: Given a zip with more files than a version holds, When planned, Then the number of files is named and nothing is unpacked', async () => {
    const zip = makeZip([
      { name: 'index.html', data: page },
      { name: 'a.css', data: 'a' },
      { name: 'b.css', data: 'b' },
      // Not deflate data: unpacking it would fail as an invalid zip.
      { name: 'c.css', data: 'c', forge: { crc32: 1 } },
    ])

    expect(await refusal(zip)).toEqual({
      reason: 'too_many_files',
      count: 4,
      limit: 3,
    })
  })

  it('F22-AC6: Given a zip that lists a file larger than one file may be, When planned, Then that file is named with the listed size', async () => {
    const zip = makeZip([
      { name: 'index.html', data: page },
      { name: 'video.mp4', data: 'x'.repeat(201) },
    ])

    expect(await refusal(zip)).toEqual({
      reason: 'file_too_large',
      path: 'video.mp4',
      size: 201,
      limit: 200,
    })
  })

  it('F22-AC6: Given a zip whose files fit one by one but not together, When planned, Then the total is named', async () => {
    const zip = makeZip([
      { name: 'index.html', data: page },
      { name: 'a.png', data: 'x'.repeat(150) },
      { name: 'b.png', data: 'y'.repeat(150) },
    ])

    expect(await refusal(zip)).toMatchObject({
      reason: 'version_too_large',
      limit: 300,
    })
  })

  it('Given the files macOS added would put the zip over the limit on files, When planned, Then they are not counted', async () => {
    const files = await planned(
      makeZip([
        { name: 'index.html', data: page },
        { name: 'a.css', data: 'a' },
        { name: 'b.css', data: 'b' },
        { name: '.DS_Store', data: 'x' },
        { name: '__MACOSX/._index.html', data: 'x' },
      ]),
      limits,
    )

    expect(files).toHaveLength(3)
  })

  it('Given a zip that says a file is small but unpacks to far more, When planned, Then it is refused and the bytes beyond the listed size are never kept', async () => {
    const zip = makeZip([
      { name: 'index.html', data: page },
      {
        name: 'big.png',
        data: new Uint8Array(30 * 1024 * 1024),
        forge: { size: 100 },
      },
    ])

    expect(await refusal(zip)).toEqual({ reason: 'invalid_zip' })
  })

  it.each([
    [
      'a file of a kind that is not taken',
      { name: 'notes.md', data: 'x' },
      { reason: 'unsupported_file', path: 'notes.md' },
    ],
    [
      'a name that leaves the slide',
      { name: '../x.html', data: 'x' },
      { reason: 'unsafe_path', path: '../x.html' },
    ],
    [
      'a second index.html',
      { name: 'index.html', data: 'x' },
      { reason: 'duplicate_path', path: 'index.html' },
    ],
    [
      'an encrypted file',
      { name: 'a.css', data: 'x', forge: { flags: 1 } },
      { reason: 'unsupported_zip', feature: 'encrypted' },
    ],
    [
      'a damaged file',
      { name: 'a.css', data: 'x', forge: { crc32: 5 } },
      { reason: 'invalid_zip' },
    ],
  ] as const)(
    'Given a zip with %s, When planned, Then the whole drop is refused for it',
    async (_name, entry, expected) => {
      const zip = makeZip([{ name: 'index.html', data: page }, entry])

      expect(await refusal(zip)).toEqual(expected)
    },
  )
})

describe('prepareDrop with a zip', () => {
  it('F22-AC3: Given a zip file, When prepared, Then it is unpacked and planned', async () => {
    const zip = makeZip([
      { name: 'index.html', data: page },
      { name: 'css/site.css', data: 'a{}' },
    ])

    const plan = await prepareDrop(
      { name: 'Talk.ZIP', size: zip.byteLength },
      async () => zip,
    )

    expect(plan.ok && plan.files.map(({ path }) => path)).toEqual([
      'index.html',
      'css/site.css',
    ])
  })

  it('F22-AC6: Given a zip far larger than one version may be, When prepared, Then it is refused naming the limit for one version without being read', async () => {
    const size = 2 * VERSION_LIMITS.deploymentBytes + 1

    expect(
      await prepareDrop({ name: 'huge.zip', size }, () =>
        Promise.reject(new Error('must not be read')),
      ),
    ).toEqual({
      ok: false,
      refusal: {
        reason: 'version_too_large',
        size,
        limit: VERSION_LIMITS.deploymentBytes,
      },
    })
  })

  it('F22-AC5: Given a file named .zip that is not a zip, When prepared, Then it is refused as unreadable', async () => {
    const bytes = new TextEncoder().encode('this is not a zip')

    expect(
      await prepareDrop(
        { name: 'fake.zip', size: bytes.length },
        async () => bytes,
      ),
    ).toEqual({ ok: false, refusal: { reason: 'invalid_zip' } })
  })
})

describe('the words for a zip that is not taken', () => {
  const refusals: readonly DropRefusal[] = [
    { reason: 'no_index' },
    { reason: 'invalid_zip' },
    { reason: 'unsupported_zip', feature: 'encrypted' },
    { reason: 'unsupported_zip', feature: 'zip64' },
    { reason: 'unsupported_zip', feature: 'compression' },
    { reason: 'unsupported_zip', feature: 'names' },
    { reason: 'unsafe_path', path: '../x.html' },
    { reason: 'duplicate_path', path: 'index.html' },
  ]

  it.each(LANGS)(
    'Given each refusal in %s, When worded, Then every one has words of its own',
    (lang) => {
      const words = refusals.map((refused) => refusalMessage(refused, lang))

      expect(new Set(words).size).toBe(refusals.length)
      for (const word of words) expect(word.length).toBeGreaterThan(8)
    },
  )

  it('F22-AC5: Given a zip with no index.html to start from, When worded, Then the reason names index.html and where it is looked for', () => {
    expect(refusalMessage({ reason: 'no_index' }, 'ja')).toBe(
      'zip の直下か、zip の中のただ 1 つのフォルダの直下に、index.html が見つかりません。',
    )
    expect(refusalMessage({ reason: 'no_index' }, 'en')).toContain('index.html')
  })

  it('Given a path with markup in it, When worded, Then it is given back as text for the page to set as text', () => {
    expect(
      refusalMessage({ reason: 'unsafe_path', path: '<img src=x>/../a' }, 'ja'),
    ).toContain('<img src=x>/../a')
  })
})
