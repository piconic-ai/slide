/**
 * Services Slide knows by name, by the exact host they serve from. A name
 * says who the other party is, so a reader need not recognize a host. It is
 * no promise that the party is safe: anyone may publish on a public CDN.
 * A host that is not listed gets no name, and nothing else changes for it.
 */
const SERVICES: ReadonlyMap<string, string> = new Map([
  ['fonts.googleapis.com', 'Google Fonts'],
  ['fonts.gstatic.com', 'Google Fonts'],
  ['use.typekit.net', 'Adobe Fonts'],
  ['p.typekit.net', 'Adobe Fonts'],
  ['cdn.jsdelivr.net', 'jsDelivr'],
  ['unpkg.com', 'unpkg'],
  ['cdnjs.cloudflare.com', 'cdnjs'],
  ['esm.sh', 'esm.sh'],
  ['api.github.com', 'GitHub'],
  ['raw.githubusercontent.com', 'GitHub'],
  ['avatars.githubusercontent.com', 'GitHub'],
  ['www.youtube.com', 'YouTube'],
  ['www.youtube-nocookie.com', 'YouTube'],
  ['i.ytimg.com', 'YouTube'],
  ['player.vimeo.com', 'Vimeo'],
  ['platform.twitter.com', 'X'],
  ['www.googletagmanager.com', 'Google Tag Manager'],
  ['www.google-analytics.com', 'Google Analytics'],
])

/** The name of the service a host belongs to, or null when Slide knows none. */
export const serviceOf = (host: string): string | null =>
  SERVICES.get(host) ?? null
