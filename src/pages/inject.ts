// Puts the page script inline into the HTML a version serves as its top
// page. Pure: bytes and the script in, bytes out; the stored file is never
// changed. See docs/dev/f03-sharing.md, "表示中のページ".
import { withInlineScript } from './csp'
import { readHead, type DocumentHead } from './markup'

/** Larger files are served as stored: the upload limit per file, by default. */
export const MAX_INJECTED_BYTES = 5 * 1024 * 1024

/**
 * More meta policies than this, and the file is served as stored. A
 * document declares one or two; each is rewritten on every full answer.
 */
export const MAX_POLICY_METAS = 16

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
export const INJECTION_REVISION = 'p1'

/**
 * The validator of a served index.html: the stored file, how the script is
 * put in, and the script itself, which together decide the bytes. It is
 * known before the file is read, so an unchanged copy is confirmed without
 * reading it.
 */
export const injectedValidator = (sha256: string, hash: string) =>
  `${sha256}-${INJECTION_REVISION}-${hash.slice(8, 24)}`

type Edit = Readonly<{ start: number; end: number; text: string }>

/**
 * Where the script goes: after the meta policies that come before the
 * document's first script, so the browser applies them to it, else at the
 * start of the head; and never after the first script, so the History API
 * is wrapped before the slide's own scripts run.
 */
function placeOf(head: DocumentHead) {
  const first = head.firstScript ?? Infinity
  const start = Math.min(head.start, first)
  const policies = head.policies
    .map((policy) => policy.end)
    .filter((end) => end <= first)
  return Math.max(start, ...policies)
}

/**
 * The meta policies' content rewritten to let the script with `hash` run,
 * or null when one cannot be: its value holds a character reference, which
 * this does not decode, so what the browser reads is not known.
 */
function policyEdits(head: DocumentHead, hash: string): Edit[] | null {
  if (head.policies.length > MAX_POLICY_METAS) return null
  const edits: Edit[] = []
  for (const { content } of head.policies) {
    if (!content) continue
    if (content.value.includes('&')) return null
    const policy = withInlineScript(content.value, hash)
    if (policy === content.value) continue
    edits.push({
      start: content.start,
      end: content.end,
      text: `"${policy.replaceAll('"', '&quot;')}"`,
    })
  }
  return edits
}

/**
 * The document with `script` inline near the start of its head, and its
 * meta policies let that script (whose hash source is `hash`) run. Nothing
 * else of the document changes. Null when the text is not a document (a
 * piece of HTML), a policy cannot be read, or there are more than
 * MAX_POLICY_METAS policies; the file is then served as it is.
 */
export function injectPageScript(
  html: string,
  script: string,
  hash: string,
): string | null {
  const head = readHead(html)
  if (!head) return null
  const edits = policyEdits(head, hash)
  if (!edits) return null
  const at = placeOf(head)
  const all = [
    ...edits,
    { start: at, end: at, text: `<script>${script}</script>` },
  ].sort((a, b) => a.start - b.start)
  // The text between the edits and the edits themselves, joined once.
  const pieces: string[] = []
  let kept = 0
  for (const edit of all) {
    pieces.push(html.slice(kept, edit.start), edit.text)
    kept = edit.end
  }
  pieces.push(html.slice(kept))
  return pieces.join('')
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
  hash: string,
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
  const injected = injectPageScript(html, script, hash)
  return injected === null ? null : new TextEncoder().encode(injected)
}
