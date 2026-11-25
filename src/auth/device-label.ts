/**
 * The rough name of a device, made from its user agent at sign-in so a
 * person can tell their sign-ins apart (F28-AC108). Only this is kept: the
 * user agent itself is not (F28-AC111). Unknown parts are null.
 */
export type DeviceLabel = Readonly<{
  os: string | null
  browser: string | null
}>

// Order matters: iPads and Android phones also claim other systems.
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMacintosh\b|\bMac OS X\b/, 'Mac'],
  [/\bWindows\b/, 'Windows'],
  [/\bLinux\b/, 'Linux'],
]

// Edge and Opera claim Chrome, and Chrome claims Safari.
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOPiOS\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
]

const first = (
  table: readonly (readonly [RegExp, string])[],
  text: string,
): string | null => table.find(([pattern]) => pattern.test(text))?.[1] ?? null

/** Longer agents are cut first, so a hostile header costs little to read. */
const MAX_AGENT_CHARS = 512

export function deviceLabel(userAgent: string | null | undefined): DeviceLabel {
  const text = (userAgent ?? '').slice(0, MAX_AGENT_CHARS)
  return { os: first(SYSTEMS, text), browser: first(BROWSERS, text) }
}

/** The label as stored: "iPhone · Safari", one part, or null when neither is known. */
export function storedDeviceLabel(label: DeviceLabel): string | null {
  const parts = [label.os, label.browser].filter((part) => part !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}
