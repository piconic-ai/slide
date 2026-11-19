import { describe, expect, it } from 'vitest'
import { PAGE_SCRIPT_SRC, withPageScript } from '../../scripts/page-script.mjs'
import { VERSION_LIMITS } from '../uploads/version-limits'
import { prepareDrop } from './browser'
import { htmlDrop, planUpload } from './plan'

const bytes = (text: string) => new TextEncoder().encode(text)
const text = (data: Uint8Array) => new TextDecoder().decode(data)
const TAG = `<script src="${PAGE_SCRIPT_SRC}"></script>`
const sha256 = async (data: Uint8Array) =>
  Buffer.from(
    await crypto.subtle.digest('SHA-256', new Uint8Array(data)),
  ).toString('hex')
const planned = async (html: string) => {
  const plan = await planUpload(htmlDrop(bytes(html)), VERSION_LIMITS)
  if (!plan.ok) throw new Error('expected a plan')
  return plan.files
}
const count = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1

describe('planUpload', () => {
  it('F22-AC7: Given a dropped HTML document, When it is planned, Then it is sent as index.html with the page script once and the inventory lists the bytes as sent', async () => {
    const [file] = await planned(
      '<!doctype html><head><title>T</title></head><body>b</body>',
    )

    expect(file?.path).toBe('index.html')
    const sent = text(file!.bytes)
    expect(sent).toBe(
      `<!doctype html><head><title>T</title>${TAG}</head><body>b</body>`,
    )
    expect(count(sent, PAGE_SCRIPT_SRC)).toBe(1)
    expect(file?.size).toBe(file?.bytes.byteLength)
    expect(file?.sha256).toBe(await sha256(file!.bytes))
  })

  it.each([
    `<!doctype html><head>${TAG}</head><body>b</body>`,
    `<html><body><script src="${PAGE_SCRIPT_SRC}" defer></script></body></html>`,
    `<html><head><SCRIPT SRC='${PAGE_SCRIPT_SRC}'></SCRIPT></head></html>`,
  ])(
    'F22-AC7: Given HTML that already loads the page script (%s), When it is planned, Then nothing is added',
    async (html) => {
      const [file] = await planned(html)

      expect(text(file!.bytes)).toBe(html)
      expect(count(text(file!.bytes).toLowerCase(), PAGE_SCRIPT_SRC)).toBe(1)
    },
  )

  it.each([
    [
      'a document with a head',
      'a.html',
      '<!doctype html><head></head><body>x</body>',
    ],
    ['a document without a head', 'a.html', '<html><body>x</body></html>'],
    ['a piece of HTML that is not a document', 'part.html', '<h1>title</h1>'],
    [
      'a script that spells </head>',
      'a.html',
      '<html><head><script>"</head>"</script></head></html>',
    ],
    ['a stylesheet', 'site.css', '</head>'],
    ['a script named like a page', 'js/page.html.js', '</head>'],
    ['an empty file', 'empty.html', ''],
  ])(
    'F22-AC7: Given %s, When it is planned, Then the bytes are what scripts/page-script.mjs gives for it',
    async (_name, path, html) => {
      const plan = await planUpload(
        [
          { path: 'index.html', bytes: bytes('<!doctype html><p>i</p>') },
          { path, bytes: bytes(html) },
        ],
        VERSION_LIMITS,
      )
      if (!plan.ok) throw new Error('expected a plan')

      const file = plan.files.find((planned) => planned.path === path)
      expect(text(file!.bytes)).toBe(text(withPageScript(path, bytes(html))))
    },
  )

  it('Given bytes that are not UTF-8, When planned, Then they are sent as they are', async () => {
    const shiftJis = new Uint8Array([0x3c, 0x70, 0x3e, 0x82, 0xa0])

    const plan = await planUpload(htmlDrop(shiftJis), VERSION_LIMITS)

    expect(plan.ok && [...plan.files[0]!.bytes]).toEqual([...shiftJis])
  })

  it('Given a path in decomposed letters, When planned, Then the inventory names it composed, as the service stores it', async () => {
    const plan = await planUpload(
      [
        { path: 'index.html', bytes: bytes('<!doctype html>') },
        { path: 'café.png', bytes: bytes('x') },
      ],
      VERSION_LIMITS,
    )

    expect(plan.ok && plan.files.map(({ path }) => path)).toEqual([
      'index.html',
      'café.png',
    ])
  })

  it('F22-AC6: Given a document that fits only before the page script is added, When planned, Then it is refused by the size as sent', async () => {
    const html = '<!doctype html><head></head>'
    const limits = { files: 1, fileBytes: html.length, deploymentBytes: 1000 }

    expect(await planUpload(htmlDrop(bytes(html)), limits)).toEqual({
      ok: false,
      refusal: {
        reason: 'file_too_large',
        path: 'index.html',
        size: html.length + TAG.length,
        limit: html.length,
      },
    })
  })
})

describe('prepareDrop', () => {
  const never = () => Promise.reject(new Error('must not be read'))

  it('F22-AC1: Given an HTML file, When prepared, Then it is planned as the slide’s index.html', async () => {
    const plan = await prepareDrop(
      { name: 'My Talk.html', size: 20 },
      async () => bytes('<!doctype html><p>x</p>'),
    )

    expect(plan.ok && plan.files.map(({ path }) => path)).toEqual([
      'index.html',
    ])
  })

  it.each(['talk.pdf', 'talk.pptx', 'folder', ''])(
    'F22-AC6: Given %j, When prepared, Then it is refused for its kind without being read',
    async (name) => {
      expect(await prepareDrop({ name, size: 1 }, never)).toEqual({
        ok: false,
        refusal: { reason: 'unsupported_kind' },
      })
    },
  )

  it('F22-AC6: Given an HTML file larger than one file may be, When prepared, Then it is refused naming that limit without being read', async () => {
    const size = VERSION_LIMITS.fileBytes + 1

    expect(await prepareDrop({ name: 'big.html', size }, never)).toEqual({
      ok: false,
      refusal: {
        reason: 'file_too_large',
        path: 'big.html',
        size,
        limit: VERSION_LIMITS.fileBytes,
      },
    })
  })

  it('Given an empty HTML file, When prepared, Then it is planned as it is', async () => {
    const plan = await prepareDrop({ name: 'a.html', size: 0 }, async () =>
      bytes(''),
    )

    expect(plan.ok && plan.files[0]?.size).toBe(0)
  })
})
