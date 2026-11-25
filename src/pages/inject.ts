// Puts the page script inline into the HTML a version serves as its top
// page. Pure: bytes and the script in, bytes out; the stored file is never
// changed, nor are the author's meta policies. See docs/dev/f03-sharing.md,
// "差し込み".
import { readHead, type DocumentHead } from './markup'

/** Larger files are served as stored: the upload limit per file, by default. */
export const MAX_INJECTED_BYTES = 5 * 1024 * 1024

const NUL = 0x00
const ESC = 0x1b
// What follows ESC in the sequences ISO-2022 uses to switch character sets
// (`ESC $ B`, `ESC ( J`, ...) and to shift for one character (`ESC N`).
// An ANSI colour (`ESC [`) is none of them.
const ISO_2022_INTERMEDIATES = new Set(
  [...'$()*+,-./NO'].map((char) => char.charCodeAt(0)),
)

/**
 * Whether the bytes are in an encoding that spells a character with bytes
 * an ASCII tag also uses: UTF-16 and UTF-32 show a NUL, the ISO-2022
 * family its escape sequences.
 */
function notAsciiCompatible(bytes: Uint8Array) {
  if (bytes.includes(NUL)) return true
  for (let at = bytes.indexOf(ESC); at !== -1; at = bytes.indexOf(ESC, at + 1))
    if (ISO_2022_INTERMEDIATES.has(bytes[at + 1] ?? -1)) return true
  return false
}

/**
 * Bumped whenever injectPageScript would change its output for the same
 * file and script, so a browser's copy is not taken for the new one.
 */
export const INJECTION_REVISION = 'p2'

/**
 * The validator of a served index.html: the stored file, how the script is
 * put in, and the script itself, which together decide the bytes. It is
 * known before the file is read, so an unchanged copy is confirmed without
 * reading it.
 */
export const injectedValidator = (sha256: string, hash: string) =>
  `${sha256}-${INJECTION_REVISION}-${hash.slice(8, 24)}`

/**
 * Where the script goes: at the start of the head, and before the first of
 * the document's meta policies and scripts if one comes earlier. A meta
 * policy governs only what follows it, so the script runs whatever the
 * author's policies allow, and it wraps the History API before the slide's
 * own scripts run.
 */
function placeOf(head: DocumentHead) {
  return Math.min(
    head.start,
    head.firstScript ?? Infinity,
    head.firstPolicy ?? Infinity,
  )
}

/**
 * The document with `script` inline near the start of its head. Nothing
 * else of the document changes. Null when the text is not a document (a
 * piece of HTML); the file is then served as it is.
 */
export function injectPageScript(html: string, script: string): string | null {
  const head = readHead(html)
  if (!head) return null
  const at = placeOf(head)
  return `${html.slice(0, at)}<script>${script}</script>${html.slice(at)}`
}

/**
 * The bytes to serve for a version's index.html: with the page script, or,
 * when it cannot safely go in, null, and the stored bytes are served. Those
 * are a file over MAX_INJECTED_BYTES, one that is not UTF-8 (the service
 * serves HTML as UTF-8) or in an encoding that is not ASCII compatible, and
 * what injectPageScript leaves.
 */
export function injectIntoBytes(
  bytes: Uint8Array,
  script: string,
): Uint8Array<ArrayBuffer> | null {
  if (bytes.length > MAX_INJECTED_BYTES) return null
  if (notAsciiCompatible(bytes)) return null
  let html: string
  try {
    html = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes,
    )
  } catch {
    return null
  }
  const injected = injectPageScript(html, script)
  return injected === null ? null : new TextEncoder().encode(injected)
}
