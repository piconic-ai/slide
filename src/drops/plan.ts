import { withPageScript } from '../../scripts/page-script.mjs'
import type { VersionLimits } from '../uploads/version-limits'
import { checkFiles, type DropRefusal } from './precheck'

/** A file of the slide as it was dropped. */
export type DropFile = Readonly<{ path: string; bytes: Uint8Array }>

/** A file as it will be sent, with what the inventory says of it. */
export type PlannedFile = Readonly<{
  path: string
  size: number
  sha256: string
  bytes: Uint8Array
}>

export type Plan =
  | Readonly<{ ok: true; files: readonly PlannedFile[] }>
  | Readonly<{ ok: false; refusal: DropRefusal }>

const hex = (digest: ArrayBuffer) =>
  Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

/**
 * What to send for a slide: each HTML document gets the page script, as the
 * uploader script adds it, and the inventory lists the bytes as sent. The
 * version is checked against the limits with those bytes, so nothing is
 * sent that the service would refuse for its size.
 */
export async function planUpload(
  files: readonly DropFile[],
  limits: VersionLimits,
): Promise<Plan> {
  const sent = files.map(({ path, bytes }) => ({
    path: path.normalize('NFC'),
    bytes: withPageScript(path, bytes),
  }))
  const refusal = checkFiles(
    sent.map(({ path, bytes }) => ({ path, size: bytes.byteLength })),
    limits,
  )
  if (refusal) return { ok: false, refusal }
  return {
    ok: true,
    files: await Promise.all(
      sent.map(async ({ path, bytes }) => ({
        path,
        size: bytes.byteLength,
        sha256: hex(
          await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)),
        ),
        bytes,
      })),
    ),
  }
}

/** The files of a dropped HTML file: it becomes the slide's index.html. */
export const htmlDrop = (bytes: Uint8Array): readonly DropFile[] => [
  { path: 'index.html', bytes },
]
