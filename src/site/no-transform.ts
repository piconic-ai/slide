/**
 * Adds `no-transform` to a Cache-Control value, keeping its other directives.
 * Cloudflare does not rewrite a body marked this way, so it injects no Web
 * Analytics beacon, which every management page's CSP would block anyway.
 */
export function withNoTransform(cacheControl: string | null): string {
  const directives = (cacheControl ?? '')
    .split(',')
    .map((directive) => directive.trim())
    .filter(Boolean)
  if (directives.some((d) => d.toLowerCase() === 'no-transform'))
    return directives.join(', ')
  return [...directives, 'no-transform'].join(', ')
}

/** Only HTML bodies get the beacon; other responses keep edge compression. */
export const isHtml = (contentType: string | null) =>
  /^text\/html\b/i.test(contentType?.trim() ?? '')
