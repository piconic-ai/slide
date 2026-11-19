import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeZip } from './test-zip'
import { crc32, readZipDirectory, unpackEntry, type ZipEntry } from './zip'

const text = (bytes: Uint8Array | null) =>
  bytes === null ? null : new TextDecoder().decode(bytes)
const entriesOf = (zip: Uint8Array): readonly ZipEntry[] => {
  const directory = readZipDirectory(zip)
  if (!directory.ok) throw new Error(`refused: ${JSON.stringify(directory)}`)
  return directory.entries
}
const refusalOf = (zip: Uint8Array) => {
  const directory = readZipDirectory(zip)
  return directory.ok ? null : directory.refusal
}

describe('readZipDirectory', () => {
  it('Given a zip of deflated and stored files in folders, When its directory is read, Then every file is listed with its path and size, and folders are not', () => {
    const zip = makeZip([
      { name: 'index.html', data: '<!doctype html>' },
      { name: 'assets/', data: '' },
      { name: 'assets/site.css', data: 'body{}', method: 0 },
      { name: 'assets/img/写真.png', data: 'png' },
    ])

    expect(
      entriesOf(zip).map(({ path, size, method }) => [path, size, method]),
    ).toEqual([
      ['index.html', 15, 8],
      ['assets/site.css', 6, 0],
      ['assets/img/写真.png', 3, 8],
    ])
  })

  it('Given a zip with a comment at its end, When read, Then the directory is still found', () => {
    const zip = makeZip([{ name: 'index.html', data: 'x' }], {
      comment: 'made by a tool '.repeat(100),
    })

    expect(entriesOf(zip).map(({ path }) => path)).toEqual(['index.html'])
  })

  it('Given a zip with no files, When read, Then it lists nothing', () => {
    expect(entriesOf(makeZip([]))).toEqual([])
  })

  it('Given a zip the system zip tool made, When read, Then its files are listed and unpack to what was packed', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'slide-zip-test-'))
    try {
      mkdirSync(join(directory, 'deck/css'), { recursive: true })
      writeFileSync(
        join(directory, 'deck/index.html'),
        '<!doctype html><p>real</p>',
      )
      writeFileSync(
        join(directory, 'deck/css/site.css'),
        'p{color:red}'.repeat(50),
      )
      execFileSync('zip', ['-q', '-r', 'deck.zip', 'deck'], { cwd: directory })
      const zip = new Uint8Array(readFileSync(join(directory, 'deck.zip')))

      const entries = entriesOf(zip)

      expect(entries.map(({ path }) => path).sort()).toEqual([
        'deck/css/site.css',
        'deck/index.html',
      ])
      const index = entries.find(({ path }) => path === 'deck/index.html')
      expect(text(await unpackEntry(zip, index!))).toBe(
        '<!doctype html><p>real</p>',
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.each([
    ['empty input', new Uint8Array()],
    ['a few bytes', new Uint8Array([0x50, 0x4b, 0x05])],
    [
      'text',
      new TextEncoder().encode('<!doctype html><p>not a zip</p>'.repeat(10)),
    ],
    [
      'a zip cut short',
      makeZip([{ name: 'index.html', data: 'x'.repeat(100) }]).subarray(0, 60),
    ],
    [
      'a directory that claims more files than it lists',
      makeZip([{ name: 'index.html', data: 'x' }], { count: 5 }),
    ],
  ])(
    'F22-AC5: Given %s, When read as a zip, Then it is refused as not a readable zip',
    (_name, bytes) => {
      expect(refusalOf(bytes)).toEqual({ reason: 'invalid_zip' })
    },
  )

  it.each([
    ['../outside.html'],
    ['assets/../../outside.html'],
    ['/etc/passwd.html'],
    ['assets//double.html'],
    ['./index.html'],
    ['C:/Users/me/index.html'],
    ['assets\\site.css'],
    ['line\nbreak.html'],
    ['nul\u0000.html'],
  ])(
    'Given a zip that names %j, When read, Then the whole zip is refused for that name',
    (name) => {
      const zip = makeZip([
        { name: 'index.html', data: 'x' },
        { name, data: 'x' },
      ])

      expect(refusalOf(zip)).toEqual({ reason: 'unsafe_path', path: name })
    },
  )

  it('Given a zip that lists one path twice, When read, Then it is refused naming the path', () => {
    const zip = makeZip([
      { name: 'index.html', data: 'first' },
      { name: 'index.html', data: 'second' },
    ])

    expect(refusalOf(zip)).toEqual({
      reason: 'duplicate_path',
      path: 'index.html',
    })
  })

  it('Given a zip with one name composed and once decomposed, When read, Then they count as the same path', () => {
    const zip = makeZip([
      { name: 'caf\u00e9.png', data: 'a' },
      { name: 'cafe\u0301.png', data: 'b' },
    ])

    expect(refusalOf(zip)).toMatchObject({ reason: 'duplicate_path' })
  })

  it.each([
    [
      'an encrypted file',
      { name: 'index.html', data: 'x', forge: { flags: 0x0801 } },
      'encrypted',
    ],
    [
      'a size kept in zip64 records',
      { name: 'index.html', data: 'x', forge: { size: 0xffffffff } },
      'zip64',
    ],
    [
      'an offset kept in zip64 records',
      { name: 'index.html', data: 'x', forge: { offset: 0xffffffff } },
      'zip64',
    ],
    [
      'a compression other than deflate',
      { name: 'index.html', data: 'x', method: 12 },
      'compression',
    ],
    [
      'a name that is not UTF-8',
      {
        name: new Uint8Array([0x83, 0x58, 0x2e, 0x68, 0x74, 0x6d, 0x6c]),
        data: 'x',
      },
      'names',
    ],
  ] as const)(
    'Given a zip with %s, When read, Then it is refused naming that feature',
    (_name, entry, feature) => {
      expect(refusalOf(makeZip([entry]))).toEqual({
        reason: 'unsupported_zip',
        feature,
      })
    },
  )

  it('Given a zip whose end says it holds 65535 files, When read, Then it is refused as zip64', () => {
    expect(refusalOf(makeZip([], { count: 0xffff }))).toEqual({
      reason: 'unsupported_zip',
      feature: 'zip64',
    })
  })
})

describe('unpackEntry', () => {
  it('Given deflated and stored files, When unpacked, Then the bytes are what was packed', async () => {
    const large = 'slide '.repeat(20000)
    const zip = makeZip([
      { name: 'index.html', data: large },
      { name: 'raw.txt', data: 'as it is', method: 0 },
      { name: 'empty.css', data: '' },
    ])
    const [index, raw, empty] = entriesOf(zip)

    expect(text(await unpackEntry(zip, index!))).toBe(large)
    expect(text(await unpackEntry(zip, raw!))).toBe('as it is')
    expect(text(await unpackEntry(zip, empty!))).toBe('')
  })

  it('Given a file that unpacks to far more than the zip says, When unpacked, Then it stops at the listed size and is refused', async () => {
    // 20 MB of zeros pack into a few kilobytes.
    const bomb = makeZip([
      {
        name: 'index.html',
        data: new Uint8Array(20 * 1024 * 1024),
        forge: { size: 10 },
      },
    ])
    const [entry] = entriesOf(bomb)
    expect(entry?.size).toBe(10)

    expect(await unpackEntry(bomb, entry!)).toBeNull()
  })

  it.each([
    ['fewer bytes than listed', { forge: { size: 50 } }],
    ['another checksum', { forge: { crc32: 1 } }],
    [
      'packed bytes that run past the end of the zip',
      { forge: { compressedSize: 100000 } },
    ],
    ['a local header that is somewhere else', { forge: { offset: 7 } }],
    ['data that is not deflate', { method: 0, forge: {} }],
  ])(
    'Given a file with %s, When unpacked, Then it is refused',
    async (name, change) => {
      const zip = makeZip([
        { name: 'index.html', data: 'hello hello hello', ...change },
      ])
      const [entry] = entriesOf(zip)
      // Stored bytes read as deflate are not valid data.
      const read =
        name === 'data that is not deflate'
          ? { ...entry!, method: 8 as const }
          : entry!

      expect(await unpackEntry(zip, read)).toBeNull()
    },
  )
})

describe('crc32', () => {
  it.each([
    ['', 0],
    ['a', 0xe8b7be43],
    ['123456789', 0xcbf43926],
  ])(
    'Given %j, When its CRC-32 is computed, Then it is the known value',
    (input, expected) => {
      expect(crc32(new TextEncoder().encode(input))).toBe(expected)
    },
  )
})
