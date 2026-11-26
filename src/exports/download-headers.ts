// The headers of an exported file. Pure.

/**
 * What every export answer carries. It is private to the person (`no-store`
 * keeps it out of any shared or browser cache, and `Vary: Cookie` says why),
 * is saved rather than shown (`attachment`), is never sniffed into another
 * type, and, if a browser were made to show it anyway, can run nothing and
 * load nothing (`sandbox`).
 */
export function downloadHeaders(
  input: Readonly<{ contentType: string; fileName: string; length?: number }>,
): Record<string, string> {
  // File names here are made of letters, digits, hyphens and one dot; a
  // name with anything else gets none rather than a header that breaks.
  const fileName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(input.fileName)
    ? input.fileName
    : 'export'
  return {
    'Content-Type': input.contentType,
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'no-store',
    Vary: 'Cookie',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Referrer-Policy': 'no-referrer',
    ...(input.length === undefined
      ? {}
      : { 'Content-Length': String(input.length) }),
  }
}

/**
 * Whether the request is one the person made: from this site's own page or
 * the address bar (`Sec-Fetch-Site` of `same-origin` or `none`), and a
 * navigation or a script's fetch (`Sec-Fetch-Dest` of `document` or `empty`,
 * not an image, frame or script tag, which a page could place to start a
 * zip without the person pressing anything). A request another site made for
 * the person's browser says `cross-site` and is refused. Callers that send
 * neither header (a command-line tool with the cookie) are not browsers and
 * pass.
 */
export const isOwnRequest = (
  fetchSite: string | null | undefined,
  fetchDest?: string | null,
): boolean =>
  (fetchSite === null ||
    fetchSite === undefined ||
    fetchSite === 'same-origin' ||
    fetchSite === 'none') &&
  (fetchDest === null ||
    fetchDest === undefined ||
    fetchDest === 'document' ||
    fetchDest === 'empty')
