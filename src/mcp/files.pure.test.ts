import { describe, expect, it } from 'vitest'
import {
  MAX_ARGUMENT_BYTES,
  MAX_ARGUMENT_FILES,
  prepareTextFiles,
} from './files'

const page =
  '<!doctype html><html><head><title>T</title></head><body>1</body></html>'
const textOf = (bytes: Uint8Array | undefined) =>
  new TextDecoder().decode(bytes)

describe('prepareTextFiles', () => {
  it('F23-AC24: Given an HTML document without the page script, When it is prepared, Then it is sent as written, and the inventory names those bytes', async () => {
    const prepared = await prepareTextFiles([
      { path: 'index.html', text: page },
      { path: 'assets/app.css', text: 'body{}' },
    ])
    if (!prepared.ok) throw new Error(prepared.message)
    const sent = textOf(prepared.bytes.get('index.html'))
    expect(sent).toBe(page)
    expect(textOf(prepared.bytes.get('assets/app.css'))).toBe('body{}')
    const entry = prepared.inventory.files.find(
      (file) => file.path === 'index.html',
    )
    expect(entry?.size).toBe(new TextEncoder().encode(sent).byteLength)
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(sent),
    )
    expect(entry?.sha256).toBe(Buffer.from(digest).toString('hex'))
    expect(prepared.inventory.totalBytes).toBe(
      (entry?.size ?? 0) + 'body{}'.length,
    )
  })

  it('Given a piece of HTML that is no document, and Japanese text, When they are prepared, Then both are sent as written', async () => {
    const prepared = await prepareTextFiles([
      { path: 'index.html', text: page },
      { path: 'part.html', text: '<p>発表 🙂</p>' },
    ])
    if (!prepared.ok) throw new Error(prepared.message)
    expect(textOf(prepared.bytes.get('part.html'))).toBe('<p>発表 🙂</p>')
  })

  it('Given an empty index.html, When it is prepared, Then it is an empty file of the inventory', async () => {
    const prepared = await prepareTextFiles([{ path: 'index.html', text: '' }])
    if (!prepared.ok) throw new Error(prepared.message)
    expect(prepared.inventory.files).toMatchObject([
      { path: 'index.html', size: 0 },
    ])
  })

  it('F23-AC6: Given text of exactly the limit, When it is prepared, Then it is taken; one byte more, Then it is refused toward begin_upload', async () => {
    const fits = await prepareTextFiles([
      { path: 'index.html', text: 'a'.repeat(MAX_ARGUMENT_BYTES) },
    ])
    expect(fits.ok).toBe(true)
    const over = await prepareTextFiles([
      { path: 'index.html', text: 'a'.repeat(MAX_ARGUMENT_BYTES) },
      { path: 'one.txt', text: 'b' },
    ])
    expect(over).toMatchObject({ ok: false, error: 'too_large_for_arguments' })
    expect(over.ok ? '' : over.message).toContain('begin_upload')
  })

  it('F23-AC6: Given text counted in characters under the limit but in UTF-8 bytes over it, When it is prepared, Then the bytes decide', async () => {
    const result = await prepareTextFiles([
      { path: 'index.html', text: 'あ'.repeat(MAX_ARGUMENT_BYTES / 3 + 1) },
    ])
    expect(result).toMatchObject({
      ok: false,
      error: 'too_large_for_arguments',
    })
  })

  it.each([
    ['no file', []],
    ['no index.html', [{ path: 'main.html', text: page }]],
    ['index.html only in a folder', [{ path: 'dist/index.html', text: page }]],
    [
      'a path that climbs out',
      [
        { path: 'index.html', text: page },
        { path: '../secret.txt', text: 'x' },
      ],
    ],
    [
      'a path with a parent segment inside',
      [
        { path: 'index.html', text: page },
        { path: 'a/../b.css', text: 'x' },
      ],
    ],
    [
      'an absolute path',
      [
        { path: 'index.html', text: page },
        { path: '/etc/passwd.txt', text: 'x' },
      ],
    ],
    [
      'a backslash path',
      [
        { path: 'index.html', text: page },
        { path: 'a\\b.css', text: 'x' },
      ],
    ],
    [
      'a hidden file',
      [
        { path: 'index.html', text: page },
        { path: '.env', text: 'x' },
      ],
    ],
    [
      'an empty path',
      [
        { path: 'index.html', text: page },
        { path: '', text: 'x' },
      ],
    ],
    [
      'a path under the service’s own prefix',
      [
        { path: 'index.html', text: page },
        { path: '_preview/pages.js', text: 'x' },
      ],
    ],
    [
      'a script the service does not serve',
      [
        { path: 'index.html', text: page },
        { path: 'run.php', text: 'x' },
      ],
    ],
    [
      'a file with no known type',
      [
        { path: 'index.html', text: page },
        { path: 'data.bin', text: 'x' },
      ],
    ],
    [
      'a file where a folder is',
      [
        { path: 'index.html', text: page },
        { path: 'a.css', text: 'x' },
        { path: 'a.css/b.css', text: 'x' },
      ],
    ],
    [
      'a path with a control character',
      [
        { path: 'index.html', text: page },
        { path: 'a\u0000.css', text: 'x' },
      ],
    ],
  ])(
    'Given %s, When the files are prepared, Then they are refused as invalid',
    async (_, files) => {
      expect(await prepareTextFiles(files)).toMatchObject({
        ok: false,
        error: 'invalid_files',
      })
    },
  )

  it.each([
    ['the same path twice', 'index.html', 'index.html'],
    ['two spellings of one path that normalize alike', 'café.css', 'café.css'],
  ])(
    'Given %s, When the files are prepared, Then the repeat is refused',
    async (_, first, second) => {
      const result = await prepareTextFiles([
        { path: 'index.html', text: page },
        { path: first, text: 'a' },
        { path: second, text: 'b' },
      ])
      expect(result).toMatchObject({ ok: false, error: 'invalid_files' })
    },
  )

  it('Given more files than are ever read, When they are prepared, Then they are refused before any is measured', async () => {
    const files = Array.from({ length: MAX_ARGUMENT_FILES + 1 }, (_, i) => ({
      path: `f${i}.css`,
      text: '',
    }))
    expect(await prepareTextFiles(files)).toMatchObject({
      ok: false,
      error: 'invalid_files',
    })
  })

  it('Given text with a lone surrogate, When it is prepared, Then it is sent as valid UTF-8', async () => {
    const prepared = await prepareTextFiles([
      { path: 'index.html', text: `${page}\ud800` },
    ])
    if (!prepared.ok) throw new Error(prepared.message)
    expect(textOf(prepared.bytes.get('index.html'))).toContain('�')
  })
})
