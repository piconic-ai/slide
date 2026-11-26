import { describe, expect, it } from 'vitest'
import { downloadHeaders, isOwnRequest } from './download-headers'

describe('downloadHeaders', () => {
  it('F35-AC27: Given a file, When headers are made, Then it is private, saved as a file, not sniffed and sandboxed', () => {
    const headers = downloadHeaders({
      contentType: 'application/zip',
      fileName: 'talk-20261126-3f2b9c1e.zip',
      length: 12,
    })
    expect(headers['Cache-Control']).toBe('no-store')
    expect(headers['Content-Disposition']).toBe(
      'attachment; filename="talk-20261126-3f2b9c1e.zip"',
    )
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Content-Security-Policy']).toBe(
      "default-src 'none'; sandbox",
    )
    expect(headers['Content-Length']).toBe('12')
  })

  it('Given no length, When headers are made, Then none is claimed', () => {
    expect(
      downloadHeaders({ contentType: 'text/markdown', fileName: 'a.md' }),
    ).not.toHaveProperty('Content-Length')
  })

  it.each([
    'a"b.zip',
    'a\r\nSet-Cookie: x=1',
    '../x.zip',
    '',
    '日本.zip',
    '.hidden',
  ])(
    'Given the file name %j, When headers are made, Then the header cannot be broken out of',
    (fileName) => {
      const header = downloadHeaders({ contentType: 'x/y', fileName })[
        'Content-Disposition'
      ]!
      expect(header).toBe('attachment; filename="export"')
    },
  )
})

describe('isOwnRequest', () => {
  it.each([
    [null, true],
    [undefined, true],
    ['same-origin', true],
    ['none', true],
    ['same-site', false],
    ['cross-site', false],
    ['', false],
    ['other', false],
  ])('Given Sec-Fetch-Site %j, When judged, Then own is %s', (site, own) => {
    expect(isOwnRequest(site)).toBe(own)
  })
})
